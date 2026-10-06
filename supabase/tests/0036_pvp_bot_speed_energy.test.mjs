// 0036: bot battles start fast (no JIT, my deck valued once per card)
import { addUsers, freshDb, helpers, unsafeFunctions } from './harness.mjs'

// 6,000 Pokémon (2,000 three-stage lines) and 60 Trainers: past the pool's
// 2000 cards, where the time used to grow with the format
async function seed(db) {
  await db.exec(`
    insert into sets (id, name, release_date, series) values ('big1', 'Big', '2020-01-01', 'Big');
    insert into cards (id, name, supertype, subtypes, hp, types, weaknesses, attacks, evolves_from, image_small, set_id)
    select 'p' || i, 'Mon ' || (i / 3) || '-' || (i % 3), 'Pokémon',
      case i % 3 when 0 then '{Basic}'::text[] when 1 then '{"Stage 1"}' else '{"Stage 2"}' end,
      50 + (i % 20) * 10, array[(array['Fire','Water','Grass','Lightning'])[1 + (i / 3) % 4]], '{Water}',
      jsonb_build_array(jsonb_build_object('name', 'Hit', 'damage', (10 + (i % 15) * 10)::text, 'base', 10 + (i % 15) * 10,
        'cost', 1 + i % 3, 'energy', jsonb_build_array('Colorless'), 'text', '', 'fx', '[]'::jsonb, 'coins', null, 'partial', false)),
      case when i % 3 = 0 then null else 'Mon ' || (i / 3) || '-' || (i % 3 - 1) end,
      'img', 'big1'
    from generate_series(0, 5999) i;
    insert into cards (id, name, supertype, subtypes, image_small, set_id, trainer)
    select 't' || i, 'Item ' || i, 'Trainer', '{Item}', 'img', 'big1',
      jsonb_build_object('playable', true, 'kind', 'item', 'ace_spec', false, 'fx', jsonb_build_array(jsonb_build_object('op', 'draw', 'n', 2)))
    from generate_series(0, 59) i;
  `)
}

async function timed(db, sql, params) {
  const { q } = helpers(db)
  const start = performance.now()
  const rows = await q(sql, params)
  return { ms: performance.now() - start, value: Object.values(rows[0])[0] }
}

export default async function (check) {
  const before = await freshDb('0035')
  const db = await freshDb('0036')
  const { q, as, asAdmin } = helpers(db)
  const one = async (sql, params) => Object.values((await q(sql, params))[0])[0]
  const unsafe = await unsafeFunctions(db)
  check(`no function writes without a WHERE${unsafe.length ? ` (${unsafe.map((f) => f.name).join(', ')})` : ''}`, unsafe.length === 0)

  await seed(before)
  await seed(db)
  const mineSql = `select jsonb_agg(pvp_card('p' || i)) from generate_series(3000, 3019) i`
  const mine = JSON.stringify(await one(mineSql))
  const call = `select pvp_bot_deck('all', 'easy', $1)`

  // 1. No JIT (PGlite has none: what made it slow live can only be checked here)
  check("pvp_bot_deck runs without JIT", (await one(`select proconfig from pg_proc where proname = 'pvp_bot_deck'`)).includes("jit=off"))

  // 2. The same work in less time with my deck (best of 2: the first call warms up)
  const best = async (d) => Math.min((await timed(d, call, [mine])).ms, (await timed(d, call, [mine])).ms)
  const old = await best(before)
  const now = await best(db)
  check(`a bot deck against mine is built at least 1.5 times faster (${Math.round(old)} ms -> ${Math.round(now)} ms)`, now * 1.5 < old)

  // 3. Still a full, legal deck, with Trainers
  const { value: bot } = await timed(db, call, [mine])
  const names = new Map()
  for (const card of bot.cards) names.set(card.name, (names.get(card.name) ?? 0) + 1)
  check('the deck has 20 cards, 2 of a name at most', bot.cards.length === 20 && [...names.values()].every((n) => n <= 2))
  check('the easy bot has its 2 Trainers', bot.cards.filter((c) => c.stage === 'trainer').length === 2)
  check('its energy is set', Array.isArray(bot.energy) && bot.energy.length > 0)

  // 4. Its strength still follows mine (85% for the easy bot, 0035)
  const strength = async (deck) =>
    Number(await one(`select avg((select count(*) from cards c where c.supertype = 'Pokémon' and pvp_card_value(pvp_card(c.id)) < pvp_card_value(b))::numeric / 6000)
      from jsonb_array_elements($1::jsonb) b where b->>'stage' <> 'trainer'`, [JSON.stringify(deck)]))
  const weak = JSON.stringify(await one(`select jsonb_agg(pvp_card('p' || (i * 15))) from generate_series(0, 19) i`))
  const strong = JSON.stringify(await one(`select jsonb_agg(pvp_card('p' || (i * 15 + 14))) from generate_series(0, 19) i`))
  const vsWeak = await strength((await one(call, [weak])).cards)
  const vsStrong = await strength((await one(call, [strong])).cards)
  check(`a stronger deck of mine still gets a stronger bot (${vsWeak.toFixed(2)} -> ${vsStrong.toFixed(2)})`, vsStrong > vsWeak)

  // 5. Energy: the live Raichu-GX case. Active: 2 Colorless for 20 or 2 Lightning + 1 for 160,
  // holding a Fire; Bench: 3 Colorless for 60; the zone brings a Fire. 0035 sent it to the Bench
  // (it can't help the 160), 0036 gives it to the Active (it opens the 20 now).
  const atk = (name, base, energy) => ({ name, damage: String(base), base, cost: energy.length, energy, text: '', fx: [], coins: null, partial: false })
  const addPair = (d) =>
    helpers(d).q(`insert into cards (id, name, supertype, subtypes, hp, types, weaknesses, attacks, image_small, set_id) values
      ('rai', 'Raichu-GX', 'Pokémon', '{Basic}', 210, '{Lightning}', '{Fighting}', $1, 'img', 'big1'),
      ('kan', 'Kangaskhan', 'Pokémon', '{Basic}', 120, '{Colorless}', '{Fighting}', $2, 'img', 'big1')`,
    [JSON.stringify([atk('Powerful Spark', 20, ['Colorless', 'Colorless']), atk('Thunder', 160, ['Lightning', 'Lightning', 'Colorless'])]),
      JSON.stringify([atk('One-Two Punch', 60, ['Colorless', 'Colorless', 'Colorless'])])])
  await addPair(db)
  await addPair(before)
  const ids = Array.from({ length: 20 }, (_, i) => (i % 2 ? 'kan' : 'rai'))
  const cards = await one(`select jsonb_agg(pvp_card(i) order by n) from unnest($1::text[]) with ordinality x(i, n)`, [ids])
  const base = await one(`select pvp_game_new($1, '["Fire", "Lightning"]', $1, '["Fire", "Lightning"]', 'easy')`, [JSON.stringify(cards)])
  const slot = (c, etypes) => ({ c, under: [], damage: 0, energy: etypes.length, etypes, turn_in: 0, status: null, status_turn: null, poisoned: false, burned: false,
    lock_attack: null, no_retreat: null, reduce: null, prevent: null, smoke: null, weaken: null, tool: null })
  const side = (s, zone, active, bench) => ({ ...base[s], active, bench, hand: [], deck: [4, 5, 6], discard: [], points: 0, attached: s === 'a', retreated: false, used_once: false, zone, next: 'Fire' })
  const game = (zone) => ({ ...base, turn: 10, phase: 'play', stage: 'play', current: 'd', events: [], promote: [], winner: null,
    a: side('a', null, slot(1, []), []), d: side('d', zone, slot(0, ['Fire']), [slot(1, [])]) })
  const aiTurn = async (d, level, zone) => Object.values((await helpers(d).q(`select pvp_ai_turn($1, 'd', $2)`, [JSON.stringify(game(zone)), level]))[0])[0]
  const attachedTo = async (level, zone) => {
    const counts = {}
    for (let i = 0; i < 20; i++) {
      const pos = (await aiTurn(db, level, zone)).events.find((e) => e.k === 'attach')?.pos ?? 'none'
      counts[pos] = (counts[pos] ?? 0) + 1
    }
    return counts
  }
  for (const level of ['easy', 'normal', 'hard']) {
    const counts = await attachedTo(level, 'Fire')
    check(`a ${level} bot gives the Fire that opens its Active's attack to the Active (${JSON.stringify(counts)})`, counts[0] === 20)
  }
  const oldPos = (await aiTurn(before, 'hard', 'Fire')).events.find((e) => e.k === 'attach')?.pos
  check(`(0035 gave it to the Bench: position ${oldPos})`, oldPos === 1)
  check('then the Active attacks', (await aiTurn(db, 'hard', 'Fire')).events.some((e) => e.k === 'attack' && e.s === 'd'))
  // A Lightning helps Thunder: still the Active
  const lightning = await attachedTo('hard', 'Lightning')
  check(`a Lightning goes to the Active too (${JSON.stringify(lightning)})`, lightning[0] === 20)

  // 6. Bot battles start at every level
  const [bazouk] = await addUsers(db, 'Bazouk')
  for (let i = 3000; i < 3030; i++) await q(`insert into collections (user_id, card_id, quantity, mode) values ($1, $2, 2, 'challenge')`, [bazouk, `p${i}`])
  const deck = Array.from({ length: 10 }, (_, i) => [`p${3000 + i * 3}`, `p${3000 + i * 3}`]).flat()
  await as(bazouk)
  await one(`select pvp_save_deck('all', $1, 'attack', '{Fire}')`, [deck])
  for (const level of ['easy', 'normal', 'hard']) {
    const state = await one(`select pvp_bot_start('all', $1)`, [level])
    check(`a ${level} bot battle starts`, state.battle?.status === 'playing' && state.battle.bot === level)
    await one(`select pvp_forfeit()`)
  }
  await asAdmin()
}
