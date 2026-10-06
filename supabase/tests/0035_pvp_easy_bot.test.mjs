// 0035: an easy bot that fights back (a stronger deck, its best attack most of the time)
import { addUsers, freshDb, helpers, unsafeFunctions } from './harness.mjs'

export default async function (check) {
  const db = await freshDb('0035')
  const { q, as, asAdmin } = helpers(db)
  const one = async (sql, params) => Object.values((await q(sql, params))[0])[0]
  const unsafe = await unsafeFunctions(db)
  check(`no function writes without a WHERE${unsafe.length ? ` (${unsafe.map((f) => f.name).join(', ')})` : ''}`, unsafe.length === 0)

  await db.exec(`insert into sets (id, name, release_date, series) values ('base1', 'Base', '1999-01-09', 'Base')`)
  const attack = (name, base, fx = []) => ({ name, damage: String(base || ''), base, cost: 1, energy: ['Colorless'], text: '', fx, coins: fx.length ? 1 : null, partial: false })
  const growl = attack('Growl', 0, [{ op: 'status', status: 'confused', target: 'opp', if: 'heads' }])
  // 30 Basics, weakest to strongest
  for (let i = 0; i < 30; i++) {
    await q(`insert into cards (id, name, supertype, subtypes, hp, types, weaknesses, attacks, image_small, set_id)
      values ($1, $2, 'Pokémon', '{Basic}', $3, '{Fire}', '{Water}', $4, 'img', 'base1')`,
      [`c${i}`, `Mon ${i}`, 40 + i * 5, JSON.stringify([growl, attack('Hit', 10 + i * 4)])])
  }

  // 1. Its deck: 85% of my deck's strength (60% before 0035)
  const mine = await one(`select jsonb_agg(pvp_card('c' || i)) from generate_series(20, 29) i`)
  let pct = 0
  for (let i = 0; i < 5; i++) {
    const bot = await one(`select pvp_bot_deck('all', 'easy', $1)`, [JSON.stringify(mine)])
    pct += Number(await one(`select avg((select count(*) from cards c where c.id ~ '^c[0-9]+$' and pvp_card_value(pvp_card(c.id)) < pvp_card_value(b))::numeric / 30)
                      from jsonb_array_elements($1::jsonb) b where b->>'stage' <> 'trainer'`, [JSON.stringify(bot.cards)]))
  }
  pct /= 5
  check(`the easy bot's deck is close to mine (its cards' percentile: ${pct.toFixed(2)})`, pct > 0.62)

  // 2. Its attack: the hit, not Growl (it picked one at random before 0035)
  const ids = Array.from({ length: 20 }, (_, i) => `c${10 + (i % 10)}`)
  const cards = await one(`select jsonb_agg(pvp_card(i) order by n) from unnest($1::text[]) with ordinality x(i, n)`, [ids])
  const base = await one(`select pvp_game_new($1, '["Fire"]', $1, '["Fire"]', 'easy')`, [JSON.stringify(cards)])
  const slot = (c) => ({ c, under: [], damage: 0, energy: 1, etypes: ['Fire'], turn_in: 0, status: null, status_turn: null, poisoned: false, burned: false,
    lock_attack: null, no_retreat: null, reduce: null, prevent: null, smoke: null, weaken: null, tool: null })
  const g = {
    ...base, turn: 4, phase: 'play', stage: 'play', current: 'd', events: [], promote: [], winner: null,
    a: { ...base.a, active: slot(0), bench: [], hand: [], deck: [1, 2, 3], discard: [], points: 0, attached: false, retreated: false, used_once: false, zone: null, next: 'Fire' },
    d: { ...base.d, active: slot(9), bench: [], hand: [], deck: [1, 2, 3], discard: [], points: 0, attached: true, retreated: false, used_once: false, zone: null, next: 'Fire' },
  }
  let hits = 0
  for (let i = 0; i < 20; i++) {
    const after = await one(`select pvp_ai_turn($1, 'd', 'easy')`, [JSON.stringify(g)])
    if (after.events.some((e) => e.k === 'attack' && e.i === 1)) hits++
  }
  check(`the easy bot uses its hit, not Growl (${hits}/20)`, hits >= 18)

  // 3. Bot battles still start at every level
  const [bazouk] = await addUsers(db, 'Bazouk')
  for (let i = 0; i < 10; i++) await q(`insert into collections (user_id, card_id, quantity, mode) values ($1, $2, 2, 'challenge')`, [bazouk, `c${20 + i}`])
  await as(bazouk)
  await one(`select pvp_save_deck('all', $1, 'attack', '{Fire}')`, [Array.from({ length: 10 }, (_, i) => [`c${20 + i}`, `c${20 + i}`]).flat()])
  for (const level of ['easy', 'normal', 'hard']) {
    const state = await one(`select pvp_bot_start('all', $1)`, [level])
    check(`a ${level} bot battle starts`, state.battle?.status === 'playing' && state.battle.bot === level)
    await one(`select pvp_forfeit()`)
  }
  await asAdmin()
}
