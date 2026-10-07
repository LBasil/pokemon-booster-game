// 0037: PvP open to every player (alpha)
import { addUsers, freshDb, helpers } from './harness.mjs'

export default async function (check) {
  const db = await freshDb('0037')
  const { q, as, asAdmin, errorOf } = helpers(db)
  const one = async (sql, params) => Object.values((await q(sql, params))[0])[0]

  await db.exec(`insert into sets (id, name, release_date, series) values ('base1', 'Base', '1999-01-09', 'Base')`)
  const attack = (name, base) => ({ name, damage: String(base), base, cost: 1, energy: ['Colorless'], text: '', fx: [], coins: null, partial: false })
  for (let i = 0; i < 30; i++) {
    await q(`insert into cards (id, name, supertype, subtypes, hp, types, weaknesses, attacks, image_small, set_id)
      values ($1, $2, 'Pokémon', '{Basic}', $3, '{Fire}', '{Water}', $4, 'img', 'base1')`,
      [`c${i}`, `Mon ${i}`, 40 + i * 5, JSON.stringify([attack('Hit', 10 + i * 4)])])
  }

  // Misty was never a tester (0028 closed it to Bazouk)
  const [misty] = await addUsers(db, 'Misty')
  for (let i = 0; i < 10; i++) await q(`insert into collections (user_id, card_id, quantity, mode) values ($1, $2, 2, 'challenge')`, [misty, `c${20 + i}`])
  await as(misty)
  const state = await one(`select pvp_state()`)
  check('any player gets the full state', state.ready === true && state.engine >= 3 && typeof state.battles_left === 'number')
  check('any player sees their eligible cards', (await one(`select jsonb_array_length(pvp_eligible('all'))`)) === 10)
  await one(`select pvp_save_deck('all', $1, 'attack', '{Fire}')`, [Array.from({ length: 10 }, (_, i) => [`c${20 + i}`, `c${20 + i}`]).flat()])
  const bot = await one(`select pvp_bot_start('all', 'easy')`)
  check('any player starts a bot battle', bot.battle?.status === 'playing' && bot.battle.bot === 'easy')
  await one(`select pvp_forfeit()`)
  check('the switch itself is still not callable', (await errorOf(`select pvp_open_to('${misty}')`)) !== '')

  // Signed out: still nothing
  await asAdmin()
  check('no user, not open', (await one(`select pvp_open_to(null)`)) === false)
  await as(null)
  check('signed out: no state', (await errorOf(`select pvp_state()`)) !== '')
}
