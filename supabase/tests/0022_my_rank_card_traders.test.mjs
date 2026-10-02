// 0022: my place in the leaderboards (my_leaderboard_rank), who has a card in double (card_traders)
import { addUsers, freshDb, helpers } from './harness.mjs'

export default async function (check) {
  const db = await freshDb('0022')
  const { q, as, asAdmin, errorOf } = helpers(db)

  await db.exec(`insert into sets (id, name) values ('s1','S1');`)
  for (let i = 0; i < 4; i++) await db.query(`insert into cards (id, name, rarity, set_id, value) values ($1,'c','Common','s1',$2)`, [`s1-${i}`, i + 1])
  const [ash, misty, brock, gary, may] = await addUsers(db, 'Ash', 'Misty', 'Brock', 'Gary', 'May')
  const add = (user, card, quantity, mode = 'challenge') =>
    q(`insert into collections (user_id, mode, card_id, quantity) values ($1,$2,$3,$4)`, [user, mode, card, quantity])
  const packs = async (user, n, hits) => {
    for (let i = 0; i < n; i++) await q(`insert into booster_openings (user_id, mode, set_id, card_ids, hits) values ($1,'unlimited','s1','{}',$2)`, [user, i < hits ? 1 : 0])
  }

  // ---------- Leaderboards ----------
  await packs(misty, 20, 5)
  await packs(brock, 25, 2)
  await packs(ash, 7, 1)
  await add(misty, 's1-3', 1, 'unlimited')
  await add(brock, 's1-1', 1, 'unlimited')
  await add(ash, 's1-0', 1, 'unlimited')

  await as(null)
  const board = await q(`select * from leaderboard('hit_rate')`)
  check('leaderboard() still answers anyone, same columns', board.length === 2 && board[0].username === 'Misty' && Number(board[0].score) === 25 && !('user_id' in board[0]))
  check('and keeps its limit', (await q(`select * from leaderboard('best_pull', 1)`)).length === 1)
  check('leaderboard_rows is not callable from outside', (await errorOf(`select * from leaderboard_rows('hit_rate')`)) !== '')
  check('anon cannot ask for their rank', (await errorOf(`select my_leaderboard_rank('hit_rate')`)) !== '')

  await as(brock)
  let mine = (await q(`select my_leaderboard_rank('hit_rate') r`))[0].r
  check('a ranked player gets their rank and score', mine.public === true && mine.rank === 2 && Number(mine.score) === 8 && mine.packs === 25)
  mine = (await q(`select my_leaderboard_rank('best_pull') r`))[0].r
  check('best_pull: rank + their card', mine.rank === 2 && mine.card_id === 's1-1')

  await as(ash)
  mine = (await q(`select my_leaderboard_rank('hit_rate') r`))[0].r
  check('below 20 packs: not ranked, with the packs opened so far', mine.public === true && mine.rank === null && mine.packs === 7)
  mine = (await q(`select my_leaderboard_rank('best_pull') r`))[0].r
  check('ranked past the shown rows too (3rd of 3)', mine.rank === 3)
  mine = (await q(`select my_leaderboard_rank('complete_sets') r`))[0].r
  check('no complete set: not ranked', mine.rank === null)
  check('an unknown board fails', (await errorOf(`select my_leaderboard_rank('nope')`)).includes('unknown leaderboard'))

  await asAdmin()
  await q(`update profiles set is_public = false where id = $1`, [brock])
  await as(brock)
  mine = (await q(`select my_leaderboard_rank('hit_rate') r`))[0].r
  check('a private profile is never ranked, and is told why', mine.public === false && mine.rank === undefined)
  await as(null)
  check('and drops off the board', (await q(`select * from leaderboard('hit_rate')`)).length === 1)

  // ---------- Who has it in double ----------
  await asAdmin()
  await q(`update profiles set is_public = true where id = $1`, [brock])
  await add(misty, 's1-2', 3) // public, accepts trades: yes
  await add(brock, 's1-2', 2) // yes
  await add(gary, 's1-2', 1) // a single copy: no
  await add(may, 's1-2', 5) // locks it below
  await add(ash, 's1-2', 4) // me: never
  await q(`insert into trade_locks (user_id, card_id) values ($1, 's1-2')`, [may])
  await add(gary, 's1-3', 2)
  await q(`update profiles set accepts_trades = false where id = $1`, [gary])

  await as(ash)
  let traders = await q(`select * from card_traders('s1-2')`)
  check('lists who has 2+ copies, most first, never me', traders.map((r) => `${r.username}:${r.quantity}`).join() === 'Misty:3,Brock:2')
  check('someone who refuses trades is left out', (await q(`select * from card_traders('s1-3')`)).length === 0)
  check('an unknown card gives nothing', (await q(`select * from card_traders('nope')`)).length === 0)
  await asAdmin()
  await q(`update profiles set is_public = false where id = $1`, [misty])
  await as(ash)
  traders = await q(`select * from card_traders('s1-2')`)
  check('a private profile is left out', traders.length === 1 && traders[0].username === 'Brock')
  await as(null)
  check('anon cannot call card_traders', (await errorOf(`select * from card_traders('s1-2')`)) !== '')
}
