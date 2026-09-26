// 0013: "Higher or lower" mini-game (challenge mode)
import { addUsers, freshDb, helpers } from './harness.mjs'

export default async function (check) {
  const db = await freshDb('0013')
  const { q, as, asAdmin, errorOf } = helpers(db)

  // Prices on a x2 ladder (0.1, 0.2, 0.4 …) so every streak level has pairs
  await db.exec(`insert into sets (id, name) values ('s1','Set One');`)
  for (let i = 0; i < 16; i++) {
    await q(`insert into cards (id, name, rarity, value, image_small, set_id) values ($1, $2, 'Rare', $3, 'img', 's1')`, [`s1-${i}`, `Card ${i}`, 0.1 * 2 ** i])
  }
  await q(`insert into cards (id, name, rarity, value, image_small, set_id) values ('cheap', 'Cheap', 'Common', 0.05, 'img', 's1'), ('noimg', 'No image', 'Rare', 50, null, 's1')`)
  const [ash, misty] = await addUsers(db, 'Ash', 'Misty')

  await as(null)
  check('signed out: no state', (await errorOf(`select minigame_state()`)) !== '')
  await as(ash)
  let state = (await q(`select minigame_state() s`))[0].s
  check('rules: 3 paid runs, 5 coins, 20 answers, 15 s', state.paid_runs === 3 && state.coins_per_answer === 5 && state.max_paid_answers === 20 && state.answer_seconds === 15)
  check('fresh player: 3 paid runs left, no run, best 0', state.paid_left === 3 && state.run === null && state.best === 0)
  check('answering without a run is refused', (await errorOf(`select minigame_answer('left')`)).includes('no_game'))
  check('players cannot read runs directly', (await errorOf(`select * from minigame_runs`)) !== '')
  check('players cannot draw pairs themselves', (await errorOf(`select * from minigame_pair(0)`)) !== '')

  state = (await q(`select minigame_start() s`))[0].s
  const run = state.run
  check('a started run is paid and shows two cards', run?.paid === true && run.left?.name && run.right?.name && run.streak === 0)
  check('the question never gives the prices away', !('value' in run.left) && !('value' in run.right))
  check('the set name comes along', run.left.set_name === 'Set One')
  check('15 seconds to answer', run.seconds_left === 15)
  check('starting uses a paid run', state.paid_left === 2)

  // Pair rules: priced (>= 0.1), with a picture, x3 to x6 apart at streak 0
  let pairsOk = true
  await asAdmin()
  const pairSql = (streak) =>
    `select p.*, a.value::float a, b.value::float b from minigame_pair(${streak}) p join cards a on a.id = p.left_card join cards b on b.id = p.right_card`
  for (let i = 0; i < 40; i++) {
    const [p] = await q(pairSql(0))
    const ratio = Math.max(p.a, p.b) / Math.min(p.a, p.b)
    if (ratio < 3 - 1e-9 || ratio > 6 + 1e-9 || [p.left_card, p.right_card].some((id) => id === 'cheap' || id === 'noimg')) pairsOk = false
  }
  check('streak 0 pairs: x3 to x6 apart, priced cards with a picture only', pairsOk)
  const [late] = await q(pairSql(12))
  const lateRatio = Math.max(late.a, late.b) / Math.min(late.a, late.b)
  check('streak 12 pairs are closer (x1.25 to x2.5)', lateRatio >= 1.25 - 1e-9 && lateRatio <= 2.5 + 1e-9)

  // The right answer, known by the admin only
  const rightPick = async (user) => {
    const [r] = await q(
      `select case when a.value >= b.value then 'left' else 'right' end pick from minigame_runs r join cards a on a.id = r.left_card join cards b on b.id = r.right_card where r.user_id = $1 and r.status = 'playing'`,
      [user],
    )
    return r.pick
  }
  const coinsOf = async (user) => (await q(`select coins from challenge_wallets where user_id = $1`, [user]))[0].coins

  const before = await coinsOf(ash)
  let pick = await rightPick(ash)
  await as(ash)
  let answer = (await q(`select minigame_answer($1) a`, [pick]))[0].a
  check('a right answer pays 5 coins', answer.correct && answer.earned === 5 && answer.streak === 1 && answer.run_coins === 5)
  check('and reveals both prices', answer.left.value > 0 && answer.right.value > 0)
  check('then a new pair comes', answer.state.run?.streak === 1 && answer.state.coins === before + 5)
  check('invalid picks are refused', (await errorOf(`select minigame_answer('middle')`)).includes('invalid_pick'))

  await asAdmin()
  const ledger = (await q(`select count(*)::int n from challenge_ledger where user_id = $1 and kind = 'minigame' and amount = 5`, [ash]))[0].n
  check('the wallet and the ledger follow', (await coinsOf(ash)) === before + 5 && ledger === 1)

  // 21 more right answers: only the first 20 of the run pay
  for (let i = 0; i < 21; i++) {
    await asAdmin()
    pick = await rightPick(ash)
    await as(ash)
    answer = (await q(`select minigame_answer($1) a`, [pick]))[0].a
  }
  check('past 20 right answers the run goes on, unpaid', answer.correct && answer.streak === 22 && answer.earned === 0 && answer.run_coins === 100)

  await asAdmin()
  pick = (await rightPick(ash)) === 'left' ? 'right' : 'left'
  await as(ash)
  answer = (await q(`select minigame_answer($1) a`, [pick]))[0].a
  check('a wrong answer ends the run, nothing paid', !answer.correct && answer.earned === 0 && answer.state.run === null)
  check('the best streak is remembered', answer.state.best === 22)
  check('today: 100 coins from the mini-game', answer.state.today_coins === 100)
  check('coins earned count for the achievements', (await q(`select player_achievements('challenge') r`))[0].r.stats.coins_earned >= 100)

  // Late answers
  await q(`select minigame_start()`)
  await asAdmin()
  await q(`update minigame_runs set shown_at = now() - interval '30 seconds' where user_id = $1 and status = 'playing'`, [ash])
  pick = await rightPick(ash)
  await as(ash)
  answer = (await q(`select minigame_answer($1) a`, [pick]))[0].a
  check('a right answer after the time limit ends the run', !answer.correct && answer.late && answer.earned === 0)

  await q(`select minigame_start()`)
  answer = (await q(`select minigame_answer(null) a`))[0].a
  check('time is up (null pick): the run ends', !answer.correct && answer.late && answer.state.run === null)

  // 3 paid runs used: the next ones are free
  state = (await q(`select minigame_start() s`))[0].s
  check('the 4th run of the day is unpaid', state.paid_left === 0 && state.run.paid === false)
  await asAdmin()
  pick = await rightPick(ash)
  await as(ash)
  answer = (await q(`select minigame_answer($1) a`, [pick]))[0].a
  check('an unpaid run earns nothing', answer.correct && answer.earned === 0)

  // Restarting abandons; a timed-out run is closed by the state
  await q(`select minigame_start()`)
  await asAdmin()
  check('restarting leaves one playing run at most', (await q(`select count(*)::int n from minigame_runs where user_id = $1 and status = 'playing'`, [ash]))[0].n === 1)
  check('the abandoned run is kept as such', (await q(`select count(*)::int n from minigame_runs where user_id = $1 and status = 'abandoned'`, [ash]))[0].n === 1)
  await q(`update minigame_runs set shown_at = now() - interval '1 minute' where user_id = $1 and status = 'playing'`, [ash])
  await as(ash)
  state = (await q(`select minigame_state() s`))[0].s
  check('a run left past its time limit is closed on the next visit', state.run === null)

  // Yesterday's paid runs don't count today
  await asAdmin()
  await q(`update minigame_runs set game_day = game_day - 1 where user_id = $1`, [ash])
  await as(ash)
  check('paid runs come back the next game day', (await q(`select minigame_state() s`))[0].s.paid_left === 3)

  // Rate limit: 20 starts a minute
  await asAdmin()
  await q(`update minigame_runs set created_at = now() where user_id = $1`, [ash])
  for (let i = 0; i < 20; i++) await q(`insert into minigame_runs (user_id, paid, status) values ($1, false, 'lost')`, [ash])
  await as(ash)
  check('more than 20 starts a minute is refused', (await errorOf(`select minigame_start()`)).includes('slow_down'))

  // Another player sees nothing of Ash's
  await as(misty)
  state = (await q(`select minigame_state() s`))[0].s
  check('another player starts from scratch', state.paid_left === 3 && state.best === 0 && state.run === null)
  check('and cannot answer for Ash', (await errorOf(`select minigame_answer('left')`)).includes('no_game'))

  await asAdmin()
  check('the ledger still accepts the old kinds', (await errorOf(`insert into challenge_ledger (user_id, kind, amount) values ($1, 'craft', -20)`, [misty])) === '')
  check('and nothing unknown', (await errorOf(`insert into challenge_ledger (user_id, kind, amount) values ($1, 'cheat', 999)`, [misty])) !== '')
}
