// 0028: PvP closed to everyone but its testers (Bazouk)
import { addUsers, freshDb, helpers } from './harness.mjs'

export default async function (check) {
  const db = await freshDb('0028')
  const { q, as, asAdmin, errorOf } = helpers(db)
  const [bazouk, misty] = await addUsers(db, 'BaZouk', 'Misty')

  await db.exec(`insert into sets (id, name, release_date, series) values ('base1', 'Base', '1999-01-09', 'Base')`)
  for (let i = 1; i <= 10; i++) {
    await q(`insert into cards (id, name, supertype, subtypes, hp, types, weaknesses, attacks, image_small, set_id)
             values ($1, $1, 'Pokémon', '{Basic}', 60, '{Fire}', '{Water}', $2, 'img', 'base1')`,
      [`c${i}`, JSON.stringify([{ name: 'Blaze', damage: '30', cost: 1 }])])
  }
  const DECK = ['c1', 'c2', 'c3', 'c4', 'c5']
  for (const user of [bazouk, misty]) {
    for (const id of DECK) await q(`insert into collections (user_id, mode, card_id, quantity) values ($1, 'challenge', $2, 1)`, [user, id])
  }

  // Not a tester: "Coming soon", nothing starts
  await as(misty)
  const closed = (await q(`select pvp_state() s`))[0].s
  check('not a tester: pvp_state says not ready, nothing else', closed.ready === false && Object.keys(closed).length === 1)
  check('not a tester: no deck saved', (await errorOf(`select pvp_save_deck('all', $1)`, [DECK])).includes('pvp_closed'))
  check('not a tester: no player battle', (await errorOf(`select pvp_start('all')`)).includes('pvp_closed'))
  check('not a tester: no bot battle', (await errorOf(`select pvp_bot_start('all', 'easy')`)).includes('pvp_closed'))
  check('the *_impl functions are not callable',
    (await errorOf(`select pvp_state_impl()`)) !== ''
    && (await errorOf(`select pvp_save_deck_impl('all', $1, 'attack')`, [DECK])) !== ''
    && (await errorOf(`select pvp_start_impl('all')`)) !== ''
    && (await errorOf(`select pvp_bot_start_impl('all', 'easy')`)) !== '')
  check('the switch itself is not callable', (await errorOf(`select pvp_open_to('${misty}')`)) !== '')

  // Bazouk (any case): everything as before
  await as(bazouk)
  const open = (await q(`select pvp_state() s`))[0].s
  check('tester: the full state', open.ready === true && open.battles_left === 10 && typeof open.bot_battles_left === 'number')
  await q(`select pvp_save_deck('all', $1)`, [DECK])
  const bot = (await q(`select pvp_bot_start('all', 'easy') s`))[0].s
  check('tester: a bot battle starts', bot.battle.status === 'playing' && bot.battle.bot === 'easy')
  const played = (await q(`select pvp_play(0, 0) r`))[0].r
  check('tester: pvp_play still works', played.round !== undefined)
  await q(`select pvp_forfeit()`)
  check('tester: no player to fight yet', (await errorOf(`select pvp_start('all')`)).includes('pvp_no_opponent'))

  // A deck saved before the switch can still be drawn as an opponent
  await asAdmin()
  await q(`insert into pvp_decks (user_id, format, role, card_ids) values ($1, 'all', 'attack', $2)`, [misty, DECK])
  await as(bazouk)
  const vs = (await q(`select pvp_start('all') s`))[0].s
  check('tester: can attack an older deck', vs.battle.opponent.username === 'Misty')

  // Renamed once: signatures and grants stay right after the double run
  await asAdmin()
  const impls = (await q(`select count(*)::int n from pg_proc where proname like 'pvp\\_%\\_impl'`))[0].n
  check('4 *_impl functions, no duplicate', impls === 4)
  await as(null)
  check('signed out: nothing', (await errorOf(`select pvp_state()`)) !== '')
}
