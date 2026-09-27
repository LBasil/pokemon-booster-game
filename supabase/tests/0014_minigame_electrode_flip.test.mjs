// 0014: "Shiny Electrode Flip" mini-game (challenge mode)
import { addUsers, freshDb, helpers } from './harness.mjs'

export default async function (check) {
  const db = await freshDb('0014')
  const { q, as, asAdmin, errorOf } = helpers(db)
  const [ash, misty] = await addUsers(db, 'Ash', 'Misty')

  // The board in progress, as only the server sees it
  const boardOf = async (user) => {
    await asAdmin()
    const [b] = await q(`select * from electrode_flip_boards where user_id = $1 and status = 'playing'`, [user])
    await as(user)
    return b
  }
  const tilesWhere = (board, test) => board.tiles.map((v, i) => (test(v) && !board.flipped[i] ? i : -1)).filter((i) => i >= 0)
  const flip = async (index) => (await q(`select electrode_flip_flip($1) r`, [index]))[0].r
  const coinsOf = async (user) => {
    await asAdmin()
    const [w] = await q(`select coins from challenge_wallets where user_id = $1`, [user])
    await as(user)
    return w.coins
  }
  // Wins the board in progress by flipping every 2 and 3
  const winBoard = async (user) => {
    const board = await boardOf(user)
    let result
    for (const i of tilesWhere(board, (v) => v >= 2)) result = await flip(i)
    return result
  }

  await as(null)
  check('signed out: no state', (await errorOf(`select electrode_flip_state()`)) !== '')
  await as(ash)
  let state = (await q(`select electrode_flip_state() s`))[0].s
  check('rules: 5 levels, 300 coins a day', state.levels === 5 && state.daily_coins === 300)
  check('fresh player: level 1, 300 coins to win, no board', state.level === 1 && state.coins_left === 300 && state.board === null && state.best_points === 0)
  check('flipping without a board is refused', (await errorOf(`select electrode_flip_flip(0)`)).includes('no_game'))
  check('players cannot read boards directly', (await errorOf(`select * from electrode_flip_boards`)) !== '')
  check('players cannot deal boards themselves', (await errorOf(`select electrode_flip_deal(1)`)) !== '')
  check('players cannot end boards themselves', (await errorOf(`select electrode_flip_end(null, 'won')`)) !== '')

  // Dealing: 25 tiles, a level-1 layout
  let dealsOk = true
  await asAdmin()
  const layouts1 = ['3,1,6', '0,3,6', '5,0,6', '2,2,6', '4,1,6']
  for (let i = 0; i < 30; i++) {
    const [{ t }] = await q(`select electrode_flip_deal(1) t`)
    const count = (v) => t.filter((x) => x === v).length
    if (t.length !== 25 || !layouts1.includes(`${count(2)},${count(3)},${count(0)}`)) dealsOk = false
  }
  check('level 1 boards follow the Voltorb Flip layouts', dealsOk)
  const [{ t: hard }] = await q(`select electrode_flip_deal(5) t`)
  check('level 5 boards hide 10 Electrodes', hard.filter((x) => x === 0).length === 10)

  await as(ash)
  state = (await q(`select electrode_flip_start() s`))[0].s
  let view = state.board
  check('a dealt board shows hints for 5 rows and 5 columns', view?.rows.length === 5 && view.cols.length === 5 && view.level === 1)
  check('no tile is given away before it is flipped', view.tiles.length === 25 && view.tiles.every((v) => v === null))
  let board = await boardOf(ash)
  const rowHint = (r) => ({
    points: board.tiles.slice(r * 5, r * 5 + 5).reduce((s, v) => s + v, 0),
    electrodes: board.tiles.slice(r * 5, r * 5 + 5).filter((v) => v === 0).length,
  })
  const colElectrodes = (c) => [0, 1, 2, 3, 4].filter((r) => board.tiles[r * 5 + c] === 0).length
  check('row hints add up the points and count the Electrodes', [0, 1, 2, 3, 4].every((r) => view.rows[r].points === rowHint(r).points && view.rows[r].electrodes === rowHint(r).electrodes))
  check('column hints count the Electrodes', [0, 1, 2, 3, 4].every((c) => view.cols[c].electrodes === colElectrodes(c)))
  check('starting again resumes the same board', JSON.stringify((await q(`select electrode_flip_start() s`))[0].s.board.rows) === JSON.stringify(view.rows))

  check('cashing out before any flip is refused', (await errorOf(`select electrode_flip_cash_out()`)).includes('nothing_to_cash'))
  check('invalid tiles are refused', (await errorOf(`select electrode_flip_flip(25)`)).includes('invalid_tile'))

  // Flip a 1 then a 2: points multiply
  const one = tilesWhere(board, (v) => v === 1)[0]
  let r = await flip(one)
  check('a 1 scores 1 point', r.value === 1 && r.result.points === 1 && r.result.flips === 1 && r.result.tiles[one] === 1)
  check('the other tiles stay hidden', r.result.tiles.filter((v) => v !== null).length === 1)
  check('a tile flips once', (await errorOf(`select electrode_flip_flip($1)`, [one])).includes('already_flipped'))

  // Win the board
  const before = await coinsOf(ash)
  const expected = board.tiles.filter((v) => v >= 2).reduce((p, v) => p * v, 1)
  r = await winBoard(ash)
  check('flipping every 2 and 3 wins the board', r.result.status === 'won' && r.result.points === expected)
  check('its points are paid in coins', r.earned === expected && (await coinsOf(ash)) === before + expected)
  check('the whole board shows once it is over', r.result.tiles.every((v) => v !== null))
  check('the next board is one level up', r.state.level === 2 && r.state.board === null)
  check('records: best board and best level', r.state.best_points === expected && r.state.best_level === 1)
  await asAdmin()
  const ledger = (await q(`select sum(amount)::int n from challenge_ledger where user_id = $1 and kind = 'electrode_flip'`, [ash]))[0].n
  check('the ledger follows', ledger === expected)
  check('coins earned count for the achievements', (await q(`select player_achievements('challenge', 'Ash') r`))[0].r.stats.coins_earned >= expected)

  // Level 2: flip one point tile then an Electrode -> lost, back to level 1
  await as(ash)
  state = (await q(`select electrode_flip_start() s`))[0].s
  check('the new board is level 2', state.board.level === 2)
  board = await boardOf(ash)
  await flip(tilesWhere(board, (v) => v >= 1)[0])
  const coinsMid = await coinsOf(ash)
  r = await flip(tilesWhere(board, (v) => v === 0)[0])
  check('an Electrode loses the board, 0 points, nothing paid', r.value === 0 && r.result.status === 'lost' && r.result.points === 0 && r.earned === 0)
  check('the wallet is untouched', (await coinsOf(ash)) === coinsMid)
  check('level drops to the tiles flipped (1)', r.state.level === 1)

  // Cash out keeps the points; the level stays if enough tiles were flipped
  await asAdmin()
  await q(`update electrode_flip_boards set next_level = 3 where user_id = $1 and status = 'lost'`, [ash])
  await as(ash)
  state = (await q(`select electrode_flip_start() s`))[0].s
  board = await boardOf(ash)
  const safe = tilesWhere(board, (v) => v >= 1).slice(0, 3)
  for (const i of safe) await flip(i)
  const points = safe.reduce((p, i) => p * board.tiles[i], 1)
  const beforeCash = await coinsOf(ash)
  r = (await q(`select electrode_flip_cash_out() r`))[0].r
  check('cashing out keeps the points', r.result.status === 'cashed' && r.result.points === points && r.earned === points)
  check('the wallet follows', (await coinsOf(ash)) === beforeCash + points)
  check('3 tiles flipped on level 3: the level stays', r.state.level === 3)
  check('no board after cashing out', (await errorOf(`select electrode_flip_cash_out()`)).includes('no_game'))

  // The daily limit: 300 coins, then boards pay nothing
  await asAdmin()
  await q(`update electrode_flip_boards set coins = 295 where id = (select min(id) from electrode_flip_boards where user_id = $1)`, [ash])
  await as(ash)
  state = (await q(`select electrode_flip_start() s`))[0].s
  const already = state.today_coins
  check('coins left today = 300 minus what was won', state.coins_left === Math.max(0, 300 - already))
  r = await winBoard(ash)
  check('a board past the limit pays what is left at most', r.earned === Math.min(r.result.points, Math.max(0, 300 - already)))
  check('nothing left to win today', r.state.coins_left === 0)
  await q(`select electrode_flip_start()`)
  r = await winBoard(ash)
  check('then boards play for the record only', r.earned === 0 && r.result.status === 'won' && r.result.points > 0)

  // Level cap
  await asAdmin()
  await q(`update electrode_flip_boards set next_level = 5 where user_id = $1`, [ash])
  await as(ash)
  await q(`select electrode_flip_start()`)
  r = await winBoard(ash)
  check('level 5 is the top', r.state.level === 5 && r.state.best_level === 5)

  // Boards are private to their player
  await as(misty)
  state = (await q(`select electrode_flip_state() s`))[0].s
  check('another player starts from scratch', state.level === 1 && state.board === null && state.best_points === 0)

  // Rate limit: 20 boards a minute
  await asAdmin()
  for (let i = 0; i < 20; i++) {
    await q(`insert into electrode_flip_boards (user_id, level, tiles, status, next_level, ended_at) values ($1, 1, electrode_flip_deal(1), 'lost', 1, now())`, [misty])
  }
  await as(misty)
  check('more than 20 boards a minute is refused', (await errorOf(`select electrode_flip_start()`)).includes('slow_down'))
}
