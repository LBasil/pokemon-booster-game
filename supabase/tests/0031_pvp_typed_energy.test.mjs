// 0031: PvP typed energy (zone, typed costs, 1-2 types per deck) + bots matched to my deck
import { addUsers, freshDb, helpers, migrationFiles, readMigration } from './harness.mjs'

export default async function (check) {
  const db = await freshDb('0030')
  const { q, as, asAdmin, errorOf } = helpers(db)
  const [bazouk, misty, ash] = await addUsers(db, 'Bazouk', 'Misty', 'Ash')

  // A 0030 battle in progress when 0031 runs: no energy types, it ends as a draw
  await q(`insert into pvp_battles (attacker, defender, format, a_deck, d_deck, a_hp, d_hp, engine, game) values ($1, $2, 'all', '[]', '[]', '{}', '{}', 2, '{}')`, [ash, misty])
  const file = migrationFiles().find((f) => f.startsWith('0031'))
  await db.exec(readMigration(file))
  await db.exec(readMigration(file))
  check('a 0030 battle in progress ends as a draw', (await q(`select status from pvp_battles where attacker = $1`, [ash]))[0].status === 'draw')

  await db.exec(`insert into sets (id, name, release_date, series) values ('base1', 'Base', '1999-01-09', 'Base'), ('sv1', 'Scarlet & Violet', '2023-03-31', 'Scarlet & Violet')`)
  const attack = (name, base, energy, fx = []) => ({ name, damage: String(base || ''), base, cost: energy.length, energy, text: '', fx, coins: null, partial: false })
  const card = (id, name, { hp = 60, type = 'Fire', weak = 'Water', stage = 'Basic', from = null, retreat = 1, attacks, set = 'base1', subtypes } = {}) =>
    q(`insert into cards (id, name, supertype, subtypes, hp, types, weaknesses, evolves_from, retreat_cost, attacks, image_small, set_id)
       values ($1, $2, 'Pokémon', $3, $4, $5, $6, $7, $8, $9, 'img', $10)`,
      [id, name, subtypes ?? [stage], hp, [type], weak ? [weak] : null, from, retreat, JSON.stringify(attacks ?? [attack('Ember', 30, ['Fire'])]), set])
  // Base: a Fire line, Fire / Water / Grass / Colorless Basics; Scarlet & Violet: big ex
  await card('charmander', 'Charmander', { hp: 60 })
  await card('charmeleon', 'Charmeleon', { hp: 90, stage: 'Stage 1', from: 'Charmander', attacks: [attack('Flame', 60, ['Fire', 'Colorless'])] })
  for (let i = 1; i <= 8; i++) await card(`vulpix${i}`, `Vulpix ${i}`, { hp: 50 + 5 * i, attacks: [attack('Fire Fang', 10 + 5 * i, ['Fire'])] })
  for (let i = 1; i <= 8; i++) await card(`squirtle${i}`, `Squirtle ${i}`, { type: 'Water', weak: 'Lightning', hp: 70, attacks: [attack('Bubble', 20, ['Water'])] })
  for (let i = 1; i <= 8; i++) await card(`oddish${i}`, `Oddish ${i}`, { type: 'Grass', weak: 'Fire', hp: 50, attacks: [attack('Leaf', 20, ['Grass', 'Grass'])] })
  await card('rattata', 'Rattata', { type: 'Colorless', weak: 'Fighting', hp: 40, attacks: [attack('Bite', 20, ['Colorless'])] })
  await card('drainer', 'Drowzee', { type: 'Psychic', weak: 'Psychic', hp: 60,
    attacks: [attack('Drain', 10, ['Psychic'], [{ op: 'discard_opp', n: 1 }])] })
  for (let i = 1; i <= 8; i++) await card(`ex${i}`, `Big ex ${i}`, { set: 'sv1', hp: 230, subtypes: ['Basic', 'ex'], attacks: [attack('Blast', 200, ['Fire', 'Fire', 'Colorless'])] })

  await asAdmin()
  const one = async (sql, params) => Object.values((await q(sql, params))[0])[0]

  // ---------- Cards and costs ----------
  const flame = (await one(`select pvp_card('charmeleon')`)).attacks[0]
  check('a snapshot carries the typed cost', flame.cost === 2 && flame.energy.join() === 'Fire,Colorless')
  await q(`insert into cards (id, name, supertype, subtypes, hp, types, attacks, image_small, set_id)
           values ('old', 'Old', 'Pokémon', '{Basic}', 50, '{Fire}', '[{"name": "Hit", "damage": "10", "base": 10, "cost": 2, "fx": []}]', 'img', 'base1')`)
  const old = (await one(`select pvp_card('old')`)).attacks[0]
  check('a card not synced yet: no types, the cost stays (all Colorless)', old.cost === 2 && old.energy.length === 0)
  const missing = (have, cost, total) => one(`select pvp_missing($1, $2, $3)`, [JSON.stringify(have), JSON.stringify(cost), total])
  check('missing: Fire + Colorless with a Fire', (await missing(['Fire'], ['Fire', 'Colorless'], 2)) === 1)
  check('missing: Water does not pay Fire', (await missing(['Water', 'Water'], ['Fire'], 1)) === 1)
  check('missing: Water pays the Colorless', (await missing(['Fire', 'Water'], ['Fire', 'Colorless'], 2)) === 0)
  check('missing: an untyped cost takes any energy', (await missing(['Water'], [], 1)) === 0 && (await missing([], [], 0)) === 0)
  check('missing: 2 Fire needed, 1 Fire + 3 Water', (await missing(['Fire', 'Water', 'Water', 'Water'], ['Fire', 'Fire'], 2)) === 1)

  check('valid energy: 1 or 2 known types', (await one(`select pvp_valid_energy('{Fire}')`)) && (await one(`select pvp_valid_energy('{Fire,Water}')`))
    && !(await one(`select pvp_valid_energy('{Fire,Water,Grass}')`)) && !(await one(`select pvp_valid_energy('{Dragon}')`))
    && !(await one(`select pvp_valid_energy('{Fire,Fire}')`)) && !(await one(`select pvp_valid_energy('{}')`)))

  // ---------- Decks ----------
  const give = async (user, ids) => {
    for (const id of ids) await q(`insert into collections (user_id, mode, card_id, quantity) values ($1, 'challenge', $2, 2) on conflict do nothing`, [user, id])
  }
  // Charmander line + 4 Vulpix + 3 Squirtles, 2 copies each = 20
  const DECK = ['charmander', 'charmeleon', 'vulpix1', 'vulpix2', 'vulpix3', 'vulpix4', 'squirtle1', 'squirtle2', 'squirtle3', 'rattata'].flatMap((id) => [id, id])
  await give(bazouk, DECK)
  const deckOf = async (ids) => (await q(`select jsonb_agg(pvp_card(i) order by n) d from unnest($1::text[]) with ordinality x(i, n)`, [ids]))[0].d
  const mine = await deckOf(DECK)
  check('a deck asks for its main types (Fire, then Water)', (await one(`select pvp_deck_energy($1)`, [JSON.stringify(mine)])).join() === 'Fire,Water')
  check('mostly Fire: Fire alone', (await one(`select pvp_deck_energy($1)`, [JSON.stringify(await deckOf(['vulpix1', 'vulpix2', 'vulpix3', 'vulpix4', 'vulpix5', 'squirtle1']))])).join() === 'Fire')

  await as(bazouk)
  check('3 types are refused', (await errorOf(`select pvp_save_deck('all', $1, 'attack', '{Fire,Water,Grass}')`, [DECK])).includes('pvp_invalid_energy'))
  let state = await one(`select pvp_save_deck('all', $1, 'attack', '{Fire}')`, [DECK])
  check('a picked energy is saved', state.decks.all.attack.energy.join() === 'Fire' && state.decks.all.attack.energy_auto === false && state.engine === 3)
  state = await one(`select pvp_save_deck('all', $1, 'defense')`, [DECK])
  check('no energy picked: it follows the cards', state.decks.all.defense.energy.join() === 'Fire,Water' && state.decks.all.defense.energy_auto === true)
  check('the rules list the energy types', state.energy_types.length === 9 && state.max_energy_types === 2)

  // ---------- The engine ----------
  await asAdmin()
  const base = await one(`select pvp_game_new($1, '["Fire"]', $1, '["Water"]', 'hard')`, [JSON.stringify(mine)])
  check('a new game: each side has its types and a next energy, no energy yet', base.a.energy_types.join() === 'Fire' && base.a.next === 'Fire'
    && base.d.energy_types.join() === 'Water' && base.d.next === 'Water' && base.a.zone === null)
  const idx = (id) => DECK.indexOf(id)
  const slot = (c, extra = {}) => ({ c, under: [], damage: 0, energy: 0, etypes: [], turn_in: 0, status: null, status_turn: null, poisoned: false, burned: false,
    lock_attack: null, no_retreat: null, reduce: null, prevent: null, smoke: null, weaken: null, ...extra })
  const typed = (types) => ({ etypes: types, energy: types.length })
  const board = ({ turn = 3, me, bench = [], them, theirBench = [], zone = 'Fire', extra = {} }) => ({
    ...base, turn, phase: 'play', stage: 'play', current: 'a', events: [], promote: [], winner: null,
    a: { ...base.a, active: me, bench, hand: [], deck: [idx('rattata')], discard: [], points: 0, attached: false, retreated: false, used_once: false, zone, next: 'Fire', ...extra.a },
    d: { ...base.d, active: them, bench: theirBench, hand: [], deck: [idx('rattata')], discard: [], points: 0, attached: false, retreated: false, used_once: false, zone: null, next: 'Water', ...extra.d },
  })
  const run = async (g, action, side = 'a') => one(`select pvp_do($1, $2, $3)`, [JSON.stringify(g), side, JSON.stringify(action)])
  const fails = (g, action) => errorOf(`select pvp_do($1, 'a', $2)`, [JSON.stringify(g), JSON.stringify(action)])

  let g = board({ me: slot(idx('charmander')), them: slot(idx('squirtle1')), zone: 'Water' })
  g = await run(g, { type: 'attach', pos: 0 })
  check('attaching takes the zone\'s energy, with its type', g.a.active.etypes.join() === 'Water' && g.a.active.energy === 1 && g.a.zone === null && g.a.attached
    && g.events.some((e) => e.k === 'attach' && e.type === 'Water'))
  check('a Water energy does not pay Ember (Fire)', (await fails(g, { type: 'attack', attack: 0 })).includes('energy'))
  check('the hint says why', (await one(`select pvp_hints($1)`, [JSON.stringify(g)])).attacks[0] === 'energy')
  check('no zone, no energy', (await fails(board({ me: slot(idx('charmander')), them: slot(idx('squirtle1')), zone: null }), { type: 'attach', pos: 0 })).includes('pvp_no_energy')
    && (await one(`select pvp_hints($1)`, [JSON.stringify(board({ me: slot(idx('charmander')), them: slot(idx('squirtle1')), zone: null }))])).attach === false)
  g = board({ me: slot(idx('charmander'), typed(['Fire'])), them: slot(idx('squirtle1')) })
  g = await run(g, { type: 'attack', attack: 0 })
  check('a Fire energy pays it', g.d.active.damage === 30)

  // Retreat drops what the attacks don't need first
  g = board({ me: slot(idx('charmander'), typed(['Fire', 'Water'])), bench: [slot(idx('rattata'))], them: slot(idx('squirtle1')) })
  g = await run(g, { type: 'retreat', pos: 1 })
  check('retreating pays with the Water, the Fire stays', g.a.bench[0].etypes.join() === 'Fire' && g.a.bench[0].energy === 1)
  // An opponent's discard drops what they need
  await asAdmin()
  const drowzee = await deckOf(['drainer'])
  const withDrowzee = { ...base, a: { ...base.a, cards: [...mine.slice(0, 19), drowzee[0]] } }
  g = board({ me: slot(19, typed(['Psychic'])), them: slot(idx('charmander'), typed(['Water', 'Fire'])) })
  g = { ...g, a: { ...g.a, cards: withDrowzee.a.cards } }
  g = await run(g, { type: 'attack', attack: 0 })
  check('an attack that discards takes the energy they need', g.d.active.etypes.join() === 'Water')

  // The zone over turns
  g = board({ turn: 4, me: slot(idx('squirtle1')), them: slot(idx('charmander'), typed(['Fire'])) })
  g = await one(`select pvp_run($1)`, [JSON.stringify({ ...g, current: 'd', stage: 'start', d: { ...g.d, next: 'Water', zone: null } })])
  const attached = g.events.find((e) => e.k === 'attach' && e.s === 'd')
  check('the server\'s turn: the announced energy arrives and is attached', attached?.type === 'Water')
  check('then my turn: my next energy arrives, a new one is announced, theirs is gone', g.current === 'a' && g.a.zone === 'Fire' && g.a.next === 'Fire' && g.d.zone === null)

  // ---------- Bots matched to my deck ----------
  await asAdmin()
  for (let i = 1; i <= 8; i++) await card(`psy${i}`, `Abra ${i}`, { type: 'Psychic', weak: 'Psychic', attacks: [attack('Psy', 20, ['Psychic'])] })
  for (let i = 1; i <= 8; i++) await card(`spark${i}`, `Pikachu ${i}`, { type: 'Lightning', weak: 'Fighting', attacks: [attack('Spark', 20, ['Lightning'])] })
  // 16 Meowths: the Base pool must reach the 60 cards pvp_bot_deck wants before
  // it falls back to the whole format (with 12 it had 57, and a bot took ex 1 run in 2)
  for (let i = 1; i <= 16; i++) await card(`meowth${i}`, `Meowth ${i}`, { type: 'Colorless', weak: 'Fighting', attacks: [attack('Scratch', 10, ['Colorless'])] })
  const fitsAll = (deck) => one(`select bool_and(pvp_fits_energy(c, $2)) from jsonb_array_elements($1) c`, [JSON.stringify(deck.cards), JSON.stringify(deck.energy)])
  let sameEra = true
  let typedOk = true
  for (let i = 0; i < 4; i++) {
    const bot = await one(`select pvp_bot_deck('all', 'normal', $1)`, [JSON.stringify(mine)])
    sameEra &&= bot.cards.length === 20 && !bot.cards.some((c) => c.id.startsWith('ex'))
    typedOk &&= bot.energy.length >= 1 && bot.energy.length <= 2 && (await fitsAll(bot))
  }
  check('a bot against a Base deck: 20 Base cards, no 2023 ex', sameEra)
  check('a bot\'s 1 or 2 energy types pay every card of its deck', typedOk)
  const hard = await one(`select pvp_bot_deck('all', 'hard', $1)`, [JSON.stringify(mine)])
  check('hard first tries the Weakness my deck shares (Water)', hard.energy[0] === 'Water')
  const exDeck = await deckOf(['ex1', 'ex2', 'ex3', 'ex4', 'ex5', 'ex6', 'ex7', 'ex8', 'ex1', 'ex2'])
  const vsEx = await one(`select pvp_bot_deck('all', 'normal', $1)`, [JSON.stringify(exDeck)])
  check('a bot against 2023 ex: its era only (too few cards there: the whole format)', vsEx.cards.length === 20)

  // ---------- A bot battle through the RPCs, to the end ----------
  await as(bazouk)
  state = await one(`select pvp_bot_start('all', 'easy')`)
  let battle = state.battle
  check('a battle shows both energy zones', battle.engine === 3 && battle.me.energy_types.join() === 'Fire' && typeof battle.them.next === 'string')
  const basics = battle.me.hand.filter((h) => h.card.stage === 'basic').map((h) => h.index)
  let result = await one(`select pvp_act($1)`, [JSON.stringify({ type: 'setup', active: basics[0], bench: basics.slice(1, 3) })])
  battle = result.battle
  let moves = 0
  let sawZone = false
  while (battle.status === 'playing' && moves++ < 300) {
    let action
    if (battle.phase === 'promote') action = { type: 'promote', pos: 1 }
    else if (battle.hints.attach) {
      sawZone ||= battle.me.zone === 'Fire'
      action = { type: 'attach', pos: 0 }
    } else if (battle.hints.attacks.some((b) => b === null)) action = { type: 'attack', attack: battle.hints.attacks.indexOf(null) }
    else action = { type: 'end' }
    result = await one(`select pvp_act($1)`, [JSON.stringify(action)])
    battle = result.battle
  }
  check('a full typed-energy battle ends', battle.status !== 'playing')
  check('my zone only ever brought Fire', sawZone)

  // Internals stay internal
  await as(bazouk)
  check('players cannot call the new internals', (await errorOf(`select pvp_bot_deck('all', 'hard', '[]')`)) !== ''
    && (await errorOf(`select pvp_missing('[]', '[]', 0)`)) !== '' && (await errorOf(`select pvp_game_new('[]', '[]', '[]', '[]', 'easy')`)) !== '')
}
