// 0018: "Evolution chain" mini-game (challenge mode)
import { addUsers, freshDb, helpers } from './harness.mjs'

export default async function (check) {
  const db = await freshDb('0018')
  const { q, as, asAdmin, errorOf } = helpers(db)
  const [ash, misty] = await addUsers(db, 'Ash', 'Misty')

  // Before populate fills evolves_from: no line to ask
  await as(ash)
  let state = (await q(`select evolution_chain_state() s`))[0].s
  check('no lines yet: the game is not ready', state.ready === false)
  check('and starting says so', (await errorOf(`select evolution_chain_start()`)).includes('evolution_chain_unavailable'))

  await asAdmin()
  await db.exec(`insert into sets (id, name) values ('s1','Set One'), ('s2','Set Two');`)
  const card = (id, name, stage, from, dex, type) =>
    q(`insert into cards (id, name, supertype, subtypes, evolves_from, national_pokedex_number, types, image_small, set_id)
       values ($1, $2, 'Pokémon', $3, $4, $5, $6, 'img', 's1')`, [id, name, [stage], from, dex, [type]])
  // Three full lines, two printings of Charmander
  await card('char', 'Charmander', 'Basic', null, 4, 'Fire')
  await card('char2', 'Charmander', 'Basic', null, 4, 'Fire')
  await card('meleon', 'Charmeleon', 'Stage 1', 'Charmander', 5, 'Fire')
  await card('zard', 'Charizard ex', 'Stage 2', 'Charmeleon', 6, 'Fire')
  await card('squirt', 'Squirtle', 'Basic', null, 7, 'Water')
  await card('wart', 'Wartortle', 'Stage 1', 'Squirtle', 8, 'Water')
  await card('blast', 'Blastoise', 'Stage 2', 'Wartortle', 9, 'Water')
  await card('bulb', 'Bulbasaur', 'Basic', null, 1, 'Grass')
  await card('ivy', 'Ivysaur', 'Stage 1', 'Bulbasaur', 2, 'Grass')
  await card('venu', 'Venusaur', 'Stage 2', 'Ivysaur', 3, 'Grass')
  // Loners and dead ends: never part of a line
  await card('pika', 'Pikachu', 'Basic', null, 25, 'Lightning')
  await card('mew', 'Mewtwo', 'Basic', null, 150, 'Psychic')
  await card('dark', 'Dark Charizard', 'Stage 2', 'Dark Charmeleon', 6, 'Fire') // its Stage 1 isn't in the database
  await card('kabu', 'Kabutops', 'Stage 2', 'Kabuto', 141, 'Fighting')
  await card('kabuto', 'Kabuto', 'Stage 1', 'Mysterious Fossil', 140, 'Fighting') // evolves from a Trainer
  await q(`insert into cards (id, name, supertype, subtypes, image_small, set_id) values ('fossil', 'Mysterious Fossil', 'Trainer', '{Item}', 'img', 's1')`)
  await q(`insert into cards (id, name, supertype, subtypes, evolves_from, image_small, set_id) values ('noimg', 'Charmeleon', 'Pokémon', '{Stage 1}', 'Charmander', null, 's1')`)

  check('cards are still readable by anyone, evolves_from included', await (async () => {
    await as(null)
    const rows = await q(`select evolves_from from cards where id = 'meleon'`)
    await asAdmin()
    return rows[0]?.evolves_from === 'Charmander'
  })())

  await as(null)
  check('signed out: no state', (await errorOf(`select evolution_chain_state()`)) !== '')
  await as(ash)
  state = (await q(`select evolution_chain_state() s`))[0].s
  check('rules: 3 paid runs, 3 coins, 20 answers, 15 s', state.paid_runs === 3 && state.coins_per_answer === 3 && state.max_paid_answers === 20 && state.answer_seconds === 15)
  check('it pays less than the other games: 180 coins a day at most', state.paid_runs * state.coins_per_answer * state.max_paid_answers === 180)
  check('full lines: ready', state.ready === true)
  check('fresh player: 3 paid runs left, no run, best 0', state.paid_left === 3 && state.run === null && state.best === 0)
  check('answering without a run is refused', (await errorOf(`select evolution_chain_answer(array['char','meleon','zard'])`)).includes('no_game'))
  check('players cannot read runs directly', (await errorOf(`select * from evolution_chain_runs`)) !== '')
  check('players cannot draw questions themselves', (await errorOf(`select * from evolution_chain_question(0)`)) !== '')

  state = (await q(`select evolution_chain_start() s`))[0].s
  const run = state.run
  check('a started run is paid and shows 3 cards', run?.paid === true && run.cards?.length === 3 && run.streak === 0)
  check('each card comes with its name and picture', run.cards.every((c) => c.id && c.name && c.image_small))
  check('the question never gives the stages away', run.cards.every((c) => Object.keys(c).sort().join() === 'id,image_small,name') && !('chain' in run))
  check('15 seconds to answer', run.seconds_left === 15)
  check('starting uses a paid run', state.paid_left === 2)

  // Question rules, checked as the admin
  await asAdmin()
  const LINES = { char: 'Fire', char2: 'Fire', squirt: 'Water', bulb: 'Grass' }
  const lineOf = { char: ['meleon', 'zard'], char2: ['meleon', 'zard'], squirt: ['wart', 'blast'], bulb: ['ivy', 'venu'] }
  let questionsOk = true
  const printings = new Set()
  for (let i = 0; i < 60; i++) {
    const [row] = await q(`select * from evolution_chain_question(0)`)
    const [base, mid, top] = row.q_chain
    if (!(base in LINES) || lineOf[base][0] !== mid || lineOf[base][1] !== top) questionsOk = false
    if (row.q_cards.length !== 3 || [...row.q_cards].sort().join() !== [...row.q_chain].sort().join()) questionsOk = false
    printings.add(base)
  }
  check('questions: full lines only, Basic -> Stage 1 -> Stage 2', questionsOk)
  check('any printing of a stage can come up', printings.has('char') && printings.has('char2'))

  const intrudersOk = async (streak, count) => {
    for (let i = 0; i < 30; i++) {
      const [row] = await q(`select * from evolution_chain_question(${streak})`)
      const extra = row.q_cards.filter((id) => !row.q_chain.includes(id))
      if (row.q_cards.length !== 3 + count || extra.length !== count) return false
      const chainNames = (await q(`select name from cards where id = any($1)`, [row.q_chain])).map((r) => r.name)
      const bad = await q(`select 1 from cards where id = any($1) and (name = any($2) or evolves_from = any($2) or supertype <> 'Pokémon')`, [extra, chainNames])
      // Dark Charizard shares Charizard's Pokédex number: never an intruder in the Charmander line
      if (bad.length || (row.q_chain[0].startsWith('char') && extra.includes('dark'))) return false
    }
    return true
  }
  check('streak 0-4: no intruder', await intrudersOk(4, 0))
  check('streak 5-9: 1 intruder from another line', await intrudersOk(5, 1))
  check('streak 10+: 2 intruders', await intrudersOk(10, 2))

  const rightOrder = async (user) =>
    (await q(`select chain from evolution_chain_runs where user_id = $1 and status = 'playing'`, [user]))[0].chain
  const coinsOf = async (user) => (await q(`select coins from challenge_wallets where user_id = $1`, [user]))[0].coins

  const before = await coinsOf(ash)
  let order = await rightOrder(ash)
  await as(ash)
  check('a card that was not shown is refused', (await errorOf(`select evolution_chain_answer(array[$1, $2, 'pika'])`, [order[0], order[1]])).includes('invalid_pick'))
  check('the same card twice is refused', (await errorOf(`select evolution_chain_answer(array[$1, $1, $2])`, [order[0], order[1]])).includes('invalid_pick'))
  check('two cards are not an answer', (await errorOf(`select evolution_chain_answer(array[$1, $2])`, [order[0], order[1]])).includes('invalid_pick'))
  let answer = (await q(`select evolution_chain_answer($1) a`, [order]))[0].a
  check('a right order pays 3 coins', answer.correct && answer.earned === 3 && answer.streak === 1 && answer.run_coins === 3)
  check('and tells the right order', JSON.stringify(answer.chain) === JSON.stringify(order))
  check('then a new line comes', answer.state.run?.streak === 1 && answer.state.coins === before + 3)

  await asAdmin()
  const ledger = (await q(`select count(*)::int n from challenge_ledger where user_id = $1 and kind = 'evolution_chain' and amount = 3`, [ash]))[0].n
  check('the wallet and the ledger follow', (await coinsOf(ash)) === before + 3 && ledger === 1)

  // 21 more right answers: only the first 20 of the run pay
  for (let i = 0; i < 21; i++) {
    await asAdmin()
    order = await rightOrder(ash)
    await as(ash)
    answer = (await q(`select evolution_chain_answer($1) a`, [order]))[0].a
  }
  check('past 20 right lines the run goes on, unpaid', answer.correct && answer.streak === 22 && answer.earned === 0 && answer.run_coins === 60)
  check('with 2 intruders by then', answer.state.run.cards.length === 5)

  await asAdmin()
  order = await rightOrder(ash)
  await as(ash)
  answer = (await q(`select evolution_chain_answer($1) a`, [[order[1], order[0], order[2]]]))[0].a
  check('a wrong order ends the run, nothing paid', !answer.correct && answer.earned === 0 && answer.state.run === null)
  check('and shows the right one', JSON.stringify(answer.chain) === JSON.stringify(order))
  check('the best streak is remembered', answer.state.best === 22)
  check('today: 60 coins from the mini-game', answer.state.today_coins === 60)
  check('coins earned count for the achievements', (await q(`select player_achievements('challenge') r`))[0].r.stats.coins_earned >= 60)

  // Late answers
  await q(`select evolution_chain_start()`)
  await asAdmin()
  await q(`update evolution_chain_runs set shown_at = now() - interval '25 seconds' where user_id = $1 and status = 'playing'`, [ash])
  order = await rightOrder(ash)
  await as(ash)
  answer = (await q(`select evolution_chain_answer($1) a`, [order]))[0].a
  check('a right order after the time limit ends the run', !answer.correct && answer.late && answer.earned === 0)

  await q(`select evolution_chain_start()`)
  answer = (await q(`select evolution_chain_answer(null) a`))[0].a
  check('time is up (null order): the run ends', !answer.correct && answer.late && answer.state.run === null)

  // 3 paid runs used: the next ones are free
  state = (await q(`select evolution_chain_start() s`))[0].s
  check('the 4th run of the day is unpaid', state.paid_left === 0 && state.run.paid === false)
  await asAdmin()
  order = await rightOrder(ash)
  await as(ash)
  answer = (await q(`select evolution_chain_answer($1) a`, [order]))[0].a
  check('an unpaid run earns nothing', answer.correct && answer.earned === 0)

  // Restarting abandons; a timed-out run is closed by the state
  await q(`select evolution_chain_start()`)
  await asAdmin()
  check('restarting leaves one playing run at most', (await q(`select count(*)::int n from evolution_chain_runs where user_id = $1 and status = 'playing'`, [ash]))[0].n === 1)
  check('the abandoned run is kept as such', (await q(`select count(*)::int n from evolution_chain_runs where user_id = $1 and status = 'abandoned'`, [ash]))[0].n === 1)
  await q(`update evolution_chain_runs set shown_at = now() - interval '1 minute' where user_id = $1 and status = 'playing'`, [ash])
  await as(ash)
  state = (await q(`select evolution_chain_state() s`))[0].s
  check('a run left past its time limit is closed on the next visit', state.run === null)

  // Yesterday's paid runs don't count today
  await asAdmin()
  await q(`update evolution_chain_runs set game_day = game_day - 1 where user_id = $1`, [ash])
  await as(ash)
  check('paid runs come back the next game day', (await q(`select evolution_chain_state() s`))[0].s.paid_left === 3)

  // Rate limit: 20 starts a minute
  await asAdmin()
  await q(`update evolution_chain_runs set created_at = now() where user_id = $1`, [ash])
  for (let i = 0; i < 20; i++) await q(`insert into evolution_chain_runs (user_id, paid, status) values ($1, false, 'lost')`, [ash])
  await as(ash)
  check('more than 20 starts a minute is refused', (await errorOf(`select evolution_chain_start()`)).includes('slow_down'))

  // Another player sees nothing of Ash's
  await as(misty)
  state = (await q(`select evolution_chain_state() s`))[0].s
  check('another player starts from scratch', state.paid_left === 3 && state.best === 0 && state.run === null)
  check('and cannot answer for Ash', (await errorOf(`select evolution_chain_answer(array['char','meleon','zard'])`)).includes('no_game'))

  await asAdmin()
  check('the ledger still accepts the old kinds', (await errorOf(`insert into challenge_ledger (user_id, kind, amount) values ($1, 'super_effective', 5)`, [misty])) === '')
  check('and nothing unknown', (await errorOf(`insert into challenge_ledger (user_id, kind, amount) values ($1, 'cheat', 999)`, [misty])) !== '')
}
