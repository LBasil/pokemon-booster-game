// 0015: "Super effective!" mini-game (challenge mode)
import { addUsers, freshDb, helpers } from './harness.mjs'

export default async function (check) {
  const db = await freshDb('0015')
  const { q, as, asAdmin, errorOf } = helpers(db)
  const [ash, misty] = await addUsers(db, 'Ash', 'Misty')

  // Before populate fills the weaknesses: nothing to ask
  await as(ash)
  let state = (await q(`select super_effective_state() s`))[0].s
  check('no weaknesses yet: the game is not ready', state.ready === false)
  check('and starting says so', (await errorOf(`select super_effective_start()`)).includes('super_effective_unavailable'))

  await asAdmin()
  await db.exec(`insert into sets (id, name) values ('s1','Set One');`)
  const types = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting']
  for (let i = 0; i < 12; i++) {
    const type = types[i % types.length]
    const weak = types[(i + 1) % types.length]
    await q(`insert into cards (id, name, types, weaknesses, image_small, set_id) values ($1, $2, $3, $4, 'img', 's1')`, [`s1-${i}`, `Card ${i}`, [type], [weak]])
  }
  // Two weaknesses; and cards that can never be asked
  await q(`insert into cards (id, name, types, weaknesses, image_small, set_id) values ('dual', 'Dual', '{Dragon}', '{Fairy,Dragon}', 'img', 's1')`)
  await q(`insert into cards (id, name, types, weaknesses, image_small, set_id) values
    ('noweak', 'No weakness', '{Dragon}', '{}', 'img', 's1'),
    ('nullweak', 'Trainer', null, null, 'img', 's1'),
    ('noimg', 'No image', '{Fire}', '{Water}', null, 's1')`)

  check('cards are still readable by anyone, weaknesses included', await (async () => {
    await as(null)
    const rows = await q(`select weaknesses from cards where id = 's1-0'`)
    await asAdmin()
    return rows[0]?.weaknesses?.[0] === 'Fire'
  })())

  await as(null)
  check('signed out: no state', (await errorOf(`select super_effective_state()`)) !== '')
  await as(ash)
  state = (await q(`select super_effective_state() s`))[0].s
  check('rules: 3 paid runs, 5 coins, 20 answers, 10 s', state.paid_runs === 3 && state.coins_per_answer === 5 && state.max_paid_answers === 20 && state.answer_seconds === 10)
  check('cards with weaknesses: ready', state.ready === true)
  check('fresh player: 3 paid runs left, no run, best 0', state.paid_left === 3 && state.run === null && state.best === 0)
  check('answering without a run is refused', (await errorOf(`select super_effective_answer('Fire')`)).includes('no_game'))
  check('players cannot read runs directly', (await errorOf(`select * from super_effective_runs`)) !== '')
  check('players cannot draw questions themselves', (await errorOf(`select * from super_effective_question(0)`)) !== '')

  state = (await q(`select super_effective_start() s`))[0].s
  const run = state.run
  check('a started run is paid and shows a card with 3 types', run?.paid === true && run.card?.name && run.options?.length === 3 && run.streak === 0)
  check('the question never gives the weakness away', !('weaknesses' in run.card) && !JSON.stringify(run).includes('answer'))
  check('the card comes with its types and set name', run.card.types?.length === 1 && run.card.set_name === 'Set One')
  check('10 seconds to answer', run.seconds_left === 10)
  check('starting uses a paid run', state.paid_left === 2)

  // Question rules, checked as the admin
  await asAdmin()
  let questionsOk = true
  for (let i = 0; i < 60; i++) {
    const [row] = await q(`select qq.*, c.weaknesses from super_effective_question(0) qq join cards c on c.id = qq.q_card`)
    const others = row.q_options.filter((t) => t !== row.q_answer)
    if (
      ['noweak', 'nullweak', 'noimg'].includes(row.q_card) ||
      row.q_options.length !== 3 ||
      new Set(row.q_options).size !== 3 ||
      !row.weaknesses.includes(row.q_answer) ||
      others.some((t) => row.weaknesses.includes(t) || t === 'Colorless')
    ) {
      questionsOk = false
    }
  }
  check('questions: askable cards only, the answer + 2 types it is not weak to', questionsOk)
  const optionCount = async (streak) => (await q(`select cardinality(q_options) n from super_effective_question(${streak})`))[0].n
  check('more types as the streak grows: 3, 4, then 6', (await optionCount(4)) === 3 && (await optionCount(5)) === 4 && (await optionCount(10)) === 6)

  const rightPick = async (user) =>
    (await q(`select answer from super_effective_runs where user_id = $1 and status = 'playing'`, [user]))[0].answer
  const wrongPick = async (user) => {
    const [r] = await q(`select answer, options from super_effective_runs where user_id = $1 and status = 'playing'`, [user])
    return r.options.find((t) => t !== r.answer)
  }
  const coinsOf = async (user) => (await q(`select coins from challenge_wallets where user_id = $1`, [user]))[0].coins

  const before = await coinsOf(ash)
  let pick = await rightPick(ash)
  await as(ash)
  check('a type that was not offered is refused', (await errorOf(`select super_effective_answer('Colorless')`)).includes('invalid_pick'))
  let answer = (await q(`select super_effective_answer($1) a`, [pick]))[0].a
  check('a right answer pays 5 coins', answer.correct && answer.earned === 5 && answer.streak === 1 && answer.run_coins === 5)
  check('and tells the answer and the weaknesses', answer.answer === pick && answer.weaknesses.includes(pick))
  check('then a new card comes', answer.state.run?.streak === 1 && answer.state.coins === before + 5)

  await asAdmin()
  const ledger = (await q(`select count(*)::int n from challenge_ledger where user_id = $1 and kind = 'super_effective' and amount = 5`, [ash]))[0].n
  check('the wallet and the ledger follow', (await coinsOf(ash)) === before + 5 && ledger === 1)

  // 21 more right answers: only the first 20 of the run pay
  for (let i = 0; i < 21; i++) {
    await asAdmin()
    pick = await rightPick(ash)
    await as(ash)
    answer = (await q(`select super_effective_answer($1) a`, [pick]))[0].a
  }
  check('past 20 right answers the run goes on, unpaid', answer.correct && answer.streak === 22 && answer.earned === 0 && answer.run_coins === 100)
  check('with 6 types to pick from by then', answer.state.run.options.length === 6)

  await asAdmin()
  pick = await wrongPick(ash)
  const expected = await rightPick(ash)
  await as(ash)
  answer = (await q(`select super_effective_answer($1) a`, [pick]))[0].a
  check('a wrong answer ends the run, nothing paid', !answer.correct && answer.earned === 0 && answer.state.run === null)
  check('and shows the right one', answer.answer === expected)
  check('the best streak is remembered', answer.state.best === 22)
  check('today: 100 coins from the mini-game', answer.state.today_coins === 100)
  check('coins earned count for the achievements', (await q(`select player_achievements('challenge') r`))[0].r.stats.coins_earned >= 100)

  // Late answers
  await q(`select super_effective_start()`)
  await asAdmin()
  await q(`update super_effective_runs set shown_at = now() - interval '20 seconds' where user_id = $1 and status = 'playing'`, [ash])
  pick = await rightPick(ash)
  await as(ash)
  answer = (await q(`select super_effective_answer($1) a`, [pick]))[0].a
  check('a right answer after the time limit ends the run', !answer.correct && answer.late && answer.earned === 0)

  await q(`select super_effective_start()`)
  answer = (await q(`select super_effective_answer(null) a`))[0].a
  check('time is up (null pick): the run ends', !answer.correct && answer.late && answer.state.run === null)

  // 3 paid runs used: the next ones are free
  state = (await q(`select super_effective_start() s`))[0].s
  check('the 4th run of the day is unpaid', state.paid_left === 0 && state.run.paid === false)
  await asAdmin()
  pick = await rightPick(ash)
  await as(ash)
  answer = (await q(`select super_effective_answer($1) a`, [pick]))[0].a
  check('an unpaid run earns nothing', answer.correct && answer.earned === 0)

  // Restarting abandons; a timed-out run is closed by the state
  await q(`select super_effective_start()`)
  await asAdmin()
  check('restarting leaves one playing run at most', (await q(`select count(*)::int n from super_effective_runs where user_id = $1 and status = 'playing'`, [ash]))[0].n === 1)
  check('the abandoned run is kept as such', (await q(`select count(*)::int n from super_effective_runs where user_id = $1 and status = 'abandoned'`, [ash]))[0].n === 1)
  await q(`update super_effective_runs set shown_at = now() - interval '1 minute' where user_id = $1 and status = 'playing'`, [ash])
  await as(ash)
  state = (await q(`select super_effective_state() s`))[0].s
  check('a run left past its time limit is closed on the next visit', state.run === null)

  // Yesterday's paid runs don't count today
  await asAdmin()
  await q(`update super_effective_runs set game_day = game_day - 1 where user_id = $1`, [ash])
  await as(ash)
  check('paid runs come back the next game day', (await q(`select super_effective_state() s`))[0].s.paid_left === 3)

  // Rate limit: 20 starts a minute
  await asAdmin()
  await q(`update super_effective_runs set created_at = now() where user_id = $1`, [ash])
  for (let i = 0; i < 20; i++) await q(`insert into super_effective_runs (user_id, paid, status) values ($1, false, 'lost')`, [ash])
  await as(ash)
  check('more than 20 starts a minute is refused', (await errorOf(`select super_effective_start()`)).includes('slow_down'))

  // Another player sees nothing of Ash's
  await as(misty)
  state = (await q(`select super_effective_state() s`))[0].s
  check('another player starts from scratch', state.paid_left === 3 && state.best === 0 && state.run === null)
  check('and cannot answer for Ash', (await errorOf(`select super_effective_answer('Fire')`)).includes('no_game'))

  await asAdmin()
  check('the ledger still accepts the old kinds', (await errorOf(`insert into challenge_ledger (user_id, kind, amount) values ($1, 'electrode_flip', 12)`, [misty])) === '')
  check('and nothing unknown', (await errorOf(`insert into challenge_ledger (user_id, kind, amount) values ($1, 'cheat', 999)`, [misty])) !== '')
}
