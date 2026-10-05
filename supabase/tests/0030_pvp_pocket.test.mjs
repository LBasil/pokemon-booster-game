// 0030: PvP like Pokémon TCG Pocket (20-card decks, Bench, energy, evolutions, effects)
import { addUsers, freshDb, helpers, migrationFiles, readMigration } from './harness.mjs'

export default async function (check) {
  const db = await freshDb('0029')
  const { q, as, asAdmin, errorOf } = helpers(db)
  const [bazouk, misty, ash] = await addUsers(db, 'Bazouk', 'Misty', 'Ash')

  // A battle of the old engine in progress when 0030 runs: it ends as a draw
  await q(`insert into pvp_battles (attacker, defender, format, a_deck, d_deck, a_hp, d_hp) values ($1, $2, 'all', '[]', '[]', '{1}', '{1}')`, [ash, misty])
  const file = migrationFiles().find((f) => f.startsWith('0030'))
  await db.exec(readMigration(file))
  await db.exec(readMigration(file))
  check('an old-engine battle in progress ends as a draw', (await q(`select status, elo_change from pvp_battles where attacker = $1`, [ash]))[0].status === 'draw')

  await db.exec(`insert into sets (id, name, release_date, series) values ('base1', 'Base', '1999-01-09', 'Base')`)
  const attack = (name, base, cost, fx = [], extra = {}) => ({ name, damage: String(base || ''), base, cost, text: '', fx, coins: null, partial: false, ...extra })
  const card = (id, name, { hp = 60, type = 'Fire', weak = 'Water', resist = null, stage = 'Basic', from = null, retreat = 1, attacks, subtypes } = {}) =>
    q(`insert into cards (id, name, supertype, subtypes, hp, types, weaknesses, resistances, evolves_from, retreat_cost, attacks, image_small, set_id, name_fr)
       values ($1, $2, 'Pokémon', $3, $4, $5, $6, $7, $8, $9, $10, 'img', 'base1', $11)`,
      [id, name, subtypes ?? [stage], hp, [type], weak ? [weak] : null, resist ? [resist] : null, from, retreat,
        JSON.stringify(attacks ?? [attack('Ember', 30, 1)]), `${name} (FR)`])
  // A Fire line, Water and Grass Basics, an ex, odd ones
  await card('charmander', 'Charmander', { hp: 60 })
  await card('charmeleon', 'Charmeleon', { hp: 90, stage: 'Stage 1', from: 'Charmander', attacks: [attack('Flame', 60, 2)] })
  await card('charizard', 'Charizard ex', { hp: 180, stage: 'Stage 2', from: 'Charmeleon', subtypes: ['Stage 2', 'ex'], retreat: 2,
    attacks: [attack('Inferno', 150, 3, [{ op: 'discard_self', n: 'all' }])] })
  for (let i = 1; i <= 8; i++) await card(`squirtle${i}`, `Squirtle ${i}`, { type: 'Water', weak: 'Lightning', hp: 70, attacks: [attack('Bubble', 20, 1)] })
  await card('oddish', 'Oddish', { type: 'Grass', weak: 'Fire', hp: 50, attacks: [attack('Poison Powder', 0, 1, [{ op: 'status', status: 'poisoned', target: 'opp' }])] })
  await card('healer', 'Chansey', { type: 'Colorless', weak: 'Fighting', hp: 120, attacks: [attack('Heal', 10, 1, [{ op: 'heal_self', n: 30 }])] })
  await card('spark', 'Pikachu', { type: 'Lightning', weak: 'Fighting', resist: 'Metal', hp: 60,
    attacks: [attack('Spark', 20, 1, [{ op: 'bench_each', n: 10 }]), attack('Shield', 0, 1, [{ op: 'prevent_next' }])] })
  await card('drawer', 'Meowth', { type: 'Colorless', hp: 50, attacks: [attack('Pay Day', 10, 1, [{ op: 'draw', n: 2 }])] })
  await card('legend', 'Ho-Oh LEGEND', { subtypes: ['LEGEND'] })
  await q(`insert into cards (id, name, supertype, subtypes, set_id, image_small) values ('potion', 'Potion', 'Trainer', '{Item}', 'base1', 'img')`)

  // ---------- Cards ----------
  await asAdmin()
  const snap = async (id) => (await q(`select pvp_card($1) c`, [id]))[0].c
  const zard = await snap('charizard')
  check('snapshot: stage, line, retreat, points, French name', zard.stage === 'evolution' && zard.evolves_from === 'Charmeleon'
    && zard.retreat === 2 && zard.prizes === 2 && zard.name_fr === 'Charizard ex (FR)')
  check('snapshot: attacks with base, cost, effects, usable', zard.attacks[0].base === 150 && zard.attacks[0].cost === 3
    && zard.attacks[0].fx[0].op === 'discard_self' && zard.attacks[0].usable === true)
  check('an effect-only attack is usable, a LEGEND half is not playable, a Trainer is no Pokémon',
    (await snap('oddish')).attacks[0].usable && (await snap('legend')).stage === 'none' && (await snap('potion')) === null)

  // ---------- Decks ----------
  const give = async (user, ids, quantity = 2) => {
    for (const id of ids) {
      await q(`insert into collections (user_id, mode, card_id, quantity) values ($1, 'challenge', $2, $3)
               on conflict (user_id, mode, card_id) do update set quantity = excluded.quantity`, [user, id, quantity])
    }
  }
  const ALL = ['charmander', 'charmeleon', 'charizard', 'squirtle1', 'squirtle2', 'squirtle3', 'squirtle4', 'squirtle5', 'squirtle6',
    'squirtle7', 'squirtle8', 'oddish', 'healer', 'spark', 'drawer', 'legend']
  await give(bazouk, ALL)
  await give(misty, ALL)
  // 2 x (Charmander line + 7 Squirtles) = 20
  const DECK = ['charmander', 'charmander', 'charmeleon', 'charmeleon', 'charizard', 'charizard',
    'squirtle1', 'squirtle1', 'squirtle2', 'squirtle2', 'squirtle3', 'squirtle3', 'drawer', 'drawer',
    'oddish', 'oddish', 'healer', 'healer', 'spark', 'spark']
  const valid = async (user, ids, format = 'all') => (await q(`select pvp_deck_cards($1, $2, $3) d`, [user, format, ids]))[0].d !== null
  check('a 20-card deck with 2 copies of each is valid', await valid(bazouk, DECK))
  check('19 cards are not', !(await valid(bazouk, DECK.slice(1))))
  check('3 copies of a name are not', !(await valid(bazouk, [...DECK.slice(0, 19), 'charmander'])))
  check('a LEGEND half is not playable', !(await valid(bazouk, [...DECK.slice(0, 19), 'legend'])))
  check('no Basic: not valid', !(await valid(bazouk, [...Array(10).fill(0).flatMap(() => ['charmeleon', 'charizard'])])))
  await q(`update collections set quantity = 1 where user_id = $1 and card_id = 'oddish'`, [bazouk])
  check('two copies need two owned', !(await valid(bazouk, DECK)))
  await q(`update collections set quantity = 2 where user_id = $1 and card_id = 'oddish'`, [bazouk])
  check('a set format only takes its cards', !(await valid(bazouk, DECK, 'set:sv1')))

  // ---------- Testers only ----------
  await as(misty)
  check('not a tester: still closed', (await q(`select pvp_state() s`))[0].s.ready === false
    && (await errorOf(`select pvp_save_deck('all', $1)`, [DECK])).includes('pvp_closed')
    && (await errorOf(`select pvp_eligible('all')`)).includes('pvp_closed'))

  await as(bazouk)
  let state = (await q(`select pvp_state() s`))[0].s
  check('rules: 20 cards, 2 copies, 3 points', state.deck_size === 20 && state.max_copies === 2 && state.points_to_win === 3 && state.engine === 2)
  const eligible = (await q(`select pvp_eligible('all') e`))[0].e
  check('eligible cards come with the copies owned, Basics first, no LEGEND', eligible[0].stage === 'basic'
    && eligible.find((c) => c.id === 'charizard').owned === 2 && !eligible.some((c) => c.id === 'legend'))
  check('an invalid deck is refused', (await errorOf(`select pvp_save_deck('all', $1)`, [DECK.slice(1)])).includes('pvp_invalid_deck'))
  state = (await q(`select pvp_save_deck('all', $1) s`, [DECK]))[0].s
  check('a saved deck comes back as ids', state.decks.all.attack.valid === true && state.decks.all.attack.ids.length === 20)

  // ---------- Bot decks ----------
  await asAdmin()
  for (let i = 1; i <= 8; i++) await card(`bulba${i}`, `Bulbasaur ${i}`, { type: 'Grass', weak: 'Fire' })
  const bot = (await q(`select pvp_bot_deck('all', 'hard') d`))[0].d
  const names = new Map()
  for (const c of bot) names.set(c.name, (names.get(c.name) ?? 0) + 1)
  check('a bot deck: 20 cards, 2 of a name at most, Basics in it', bot.length === 20 && Math.max(...names.values()) <= 2 && bot.some((c) => c.stage === 'basic'))
  check('a bot deck: every evolution has what it evolves from', bot.filter((c) => c.stage === 'evolution').every((c) => names.has(c.evolves_from)))

  // ---------- The engine, on hand-built games ----------
  const deckOf = async (ids) => (await q(`select jsonb_agg(pvp_card(i) order by n) d from unnest($1::text[]) with ordinality x(i, n)`, [ids]))[0].d
  const mine = await deckOf(DECK)
  const base = (await q(`select pvp_game_new($1, $1, 'hard') g`, [JSON.stringify(mine)]))[0].g
  check('a new game: 5 cards in hand with a Basic, 15 in the deck, the server set up', base.a.hand.length === 5
    && base.a.hand.some((i) => mine[i].stage === 'basic') && base.a.deck.length === 15 && base.d.active !== null && base.phase === 'setup')
  const slot = (c, extra = {}) => ({ c, under: [], damage: 0, energy: 0, turn_in: 0, status: null, status_turn: null, poisoned: false, burned: false,
    lock_attack: null, no_retreat: null, reduce: null, prevent: null, smoke: null, weaken: null, ...extra })
  const idx = (id) => DECK.indexOf(id)
  // a board: my Active / Bench / hand, their Active / Bench
  const board = ({ turn = 3, me, bench = [], hand = [], them, theirBench = [], extra = {} }) => ({
    ...base, turn, phase: 'play', stage: 'play', current: 'a', events: [], promote: [], winner: null,
    a: { ...base.a, active: me, bench, hand, deck: [idx('squirtle1'), idx('healer')], discard: [], points: 0, attached: false, retreated: false, used_once: false, ...extra.a },
    d: { ...base.d, active: them, bench: theirBench, hand: [], deck: [idx('squirtle1')], discard: [], points: 0, attached: false, retreated: false, used_once: false, ...extra.d },
  })
  const run = async (g, action, side = 'a') => (await q(`select pvp_do($1, $2, $3) g`, [JSON.stringify(g), side, JSON.stringify(action)]))[0].g
  const fails = async (g, action) => errorOf(`select pvp_do($1, 'a', $2)`, [JSON.stringify(g), JSON.stringify(action)])

  let g = board({ turn: 1, me: slot(idx('charmander')), hand: [idx('squirtle1')], them: slot(idx('squirtle2')) })
  check('the first turn: no energy, no attack', (await fails(g, { type: 'attach', pos: 0 })).includes('pvp_no_energy')
    && (await fails({ ...g, a: { ...g.a, active: slot(idx('charmander'), { energy: 1 }) } }, { type: 'attack', attack: 0 })).includes('first_turn'))
  g = await run(g, { type: 'bench', card: idx('squirtle1') })
  check('a Basic goes to the Bench on any turn', g.a.bench.length === 1 && g.a.hand.length === 0)

  g = board({ turn: 3, me: slot(idx('charmander')), hand: [idx('charmeleon'), idx('charizard')], them: slot(idx('squirtle2')) })
  g = await run(g, { type: 'attach', pos: 0 })
  check('one energy a turn', g.a.active.energy === 1 && (await fails(g, { type: 'attach', pos: 0 })).includes('pvp_no_energy'))
  check('no Stage 2 straight on a Basic', (await fails(g, { type: 'evolve', card: idx('charizard'), pos: 0 })).includes('pvp_invalid_action'))
  check('no evolving on a first turn', (await fails({ ...g, turn: 2 }, { type: 'evolve', card: idx('charmeleon'), pos: 0 })).includes('pvp_cannot_evolve_yet'))
  g = await run(g, { type: 'evolve', card: idx('charmeleon'), pos: 0 })
  check('evolving keeps the energy, the card goes under', g.a.active.c === idx('charmeleon') && g.a.active.under[0] === idx('charmander') && g.a.active.energy === 1)
  check('not twice in a turn', (await fails(g, { type: 'evolve', card: idx('charizard'), pos: 0 })).includes('pvp_cannot_evolve_yet'))

  // Retreat: pay the cost, the Benched one comes in, conditions cured
  g = board({ me: slot(idx('charmander'), { energy: 1, poisoned: true }), bench: [slot(idx('squirtle1'))], them: slot(idx('squirtle2')) })
  g = await run(g, { type: 'retreat', pos: 1 })
  check('retreat pays its cost and cures', g.a.active.c === idx('squirtle1') && g.a.bench[0].energy === 0 && g.a.bench[0].poisoned === false)
  check('once a turn', (await fails(g, { type: 'retreat', pos: 1 })).includes('pvp_cannot_retreat'))
  g = board({ me: slot(idx('charmander'), { energy: 0 }), bench: [slot(idx('squirtle1'))], them: slot(idx('squirtle2')) })
  check('not without the energy', (await fails(g, { type: 'retreat', pos: 1 })).includes('pvp_cannot_retreat'))
  g = board({ me: slot(idx('charmander'), { energy: 2, status: 'paralyzed', status_turn: 2 }), bench: [slot(idx('squirtle1'))], them: slot(idx('squirtle2')) })
  check('Paralyzed: no retreat, no attack', (await fails(g, { type: 'retreat', pos: 1 })).includes('pvp_cannot_retreat')
    && (await fails(g, { type: 'attack', attack: 0 })).includes('paralyzed'))

  // Damage: Weakness x2, Resistance -30
  g = board({ me: slot(idx('squirtle1'), { energy: 1 }), them: slot(idx('charmander')), theirBench: [slot(idx('oddish'))] })
  g = await run(g, { type: 'attack', attack: 0 })
  check('Weakness doubles (20 -> 40), the turn ends', g.d.active.damage === 40 && g.stage === 'end')
  g = board({ me: slot(idx('charmander'), { energy: 1 }), them: slot(idx('squirtle2'), { energy: 1 }) })
  check('no energy, no attack', (await fails({ ...g, a: { ...g.a, active: slot(idx('charmeleon')) } }, { type: 'attack', attack: 0 })).includes('energy'))

  // Knock out: points, the Active to promote; an ex gives 2
  g = board({ me: slot(idx('squirtle1'), { energy: 1 }), them: slot(idx('charizard'), { damage: 160 }), theirBench: [slot(idx('oddish'))] })
  g = await run(g, { type: 'attack', attack: 0 })
  check('knocking out an ex: 2 points, their card discarded, they promote', g.a.points === 2 && g.d.active === null
    && g.promote.includes('d') && g.d.discard.includes(idx('charizard')))
  g = board({ me: slot(idx('squirtle1'), { energy: 1 }), them: slot(idx('charizard'), { damage: 160 }), extra: { a: { points: 1 } } })
  g = await run(g, { type: 'attack', attack: 0 })
  check('3 points win (and no Pokémon left too)', g.phase === 'over' && g.winner === 'a')

  // Effects
  g = board({ me: slot(idx('oddish'), { energy: 1 }), them: slot(idx('squirtle2')) })
  g = await run(g, { type: 'attack', attack: 0 })
  check('a special condition', g.d.active.poisoned === true)
  g = (await q(`select pvp_checkup($1) g`, [JSON.stringify(g)]))[0].g
  check('Poison: 10 between turns', g.d.active.damage === 10)
  g = board({ me: slot(idx('healer'), { energy: 1, damage: 50 }), them: slot(idx('squirtle2')) })
  g = await run(g, { type: 'attack', attack: 0 })
  check('heal 30 from itself', g.a.active.damage === 20 && g.d.active.damage === 10)
  g = board({ me: slot(idx('spark'), { energy: 1 }), them: slot(idx('squirtle2')), theirBench: [slot(idx('squirtle3')), slot(idx('oddish'))] })
  g = await run(g, { type: 'attack', attack: 0 })
  check('10 to each Benched Pokémon (no Weakness there), 20 x2 on the Active', g.d.bench.every((b) => b.damage === 10) && g.d.active.damage === 40)
  g = board({ me: slot(idx('charizard'), { energy: 3 }), them: slot(idx('squirtle2'), { damage: 0 }), theirBench: [slot(idx('oddish'))] })
  g = await run(g, { type: 'attack', attack: 0 })
  check('discard all energy after a big hit', g.a.active.energy === 0 && g.a.points === 1)
  g = board({ me: slot(idx('spark'), { energy: 1 }), them: slot(idx('squirtle2'), { energy: 1 }) })
  g = await run(g, { type: 'attack', attack: 1 })
  check('prevent_next is set for the next turn', g.a.active.prevent === 4)
  g = { ...g, turn: 4, current: 'd', stage: 'play' }
  g = await run(g, { type: 'attack', attack: 0 }, 'd')
  check('and stops their attack', g.a.active.damage === 0)
  g = board({ me: slot(idx('drawer'), { energy: 1 }), them: slot(idx('squirtle2')) })
  g = await run(g, { type: 'attack', attack: 0 })
  check('draw 2 (as many as the deck has)', g.a.hand.length === 2 && g.a.deck.length === 0)

  // Hints
  g = board({ me: slot(idx('charmander'), { energy: 1 }), bench: [slot(idx('squirtle1'))], hand: [idx('charmeleon'), idx('squirtle3')], them: slot(idx('squirtle2')) })
  const hints = (await q(`select pvp_hints($1) h`, [JSON.stringify(g)]))[0].h
  check('hints: attach, retreat, attacks, what each hand card can do', hints.my_turn && hints.attach && hints.retreat
    && hints.attacks[0] === null && hints.hand[idx('charmeleon')].evolve.join() === '0' && hints.hand[idx('squirtle3')].bench === true)

  // A whole server turn
  g = board({ turn: 4, me: slot(idx('squirtle1')), them: slot(idx('charmander'), { energy: 1 }) })
  g = (await q(`select pvp_run($1) g`, [JSON.stringify({ ...g, current: 'd', stage: 'start' })]))[0].g
  check('the server draws, attaches, attacks, then it is my turn with a card drawn', g.current === 'a' && g.phase === 'play'
    && g.events.some((e) => e.k === 'attack' && e.s === 'd') && g.events.some((e) => e.k === 'draw' && e.s === 'a'))

  // ---------- Through the RPCs: a bot battle to the end ----------
  await as(bazouk)
  state = (await q(`select pvp_bot_start('all', 'easy') s`))[0].s
  let battle = state.battle
  check('a bot battle starts in setup, my hand shown, their hand a count', battle.phase === 'setup' && battle.me.hand.length === 5
    && battle.them.hand_count >= 0 && battle.them.active !== null && battle.hints.setup === true && battle.them.cards === null)
  const basics = battle.me.hand.filter((h) => h.card.stage === 'basic').map((h) => h.index)
  const notBasic = battle.me.hand.find((h) => h.card.stage !== 'basic')
  if (notBasic) check('the Active must be a Basic', (await errorOf(`select pvp_act($1)`, [JSON.stringify({ type: 'setup', active: notBasic.index })])).includes('pvp_invalid_action'))
  let result = (await q(`select pvp_act($1) r`, [JSON.stringify({ type: 'setup', active: basics[0], bench: basics.slice(1, 3) })]))[0].r
  battle = result.battle
  check('after setup it is my turn (the bot played first or not)', battle.phase === 'play' && battle.current === 'a' && battle.hints.my_turn)
  check('their draws are hidden', result.events.filter((e) => e.k === 'draw' && e.s === 'd').every((e) => !e.cards))
  check('events name their cards', result.events.filter((e) => 'c' in e).every((e) => typeof e.name === 'string'))
  // Play it out: attach to the Active, attack when possible, else end
  let moves = 0
  while (battle.status === 'playing' && moves++ < 200) {
    let action
    if (battle.phase === 'promote') action = { type: 'promote', pos: 1 }
    else if (battle.hints.attach) action = { type: 'attach', pos: 0 }
    else if (battle.hints.attacks.some((b) => b === null)) action = { type: 'attack', attack: battle.hints.attacks.indexOf(null) }
    else action = { type: 'end' }
    result = (await q(`select pvp_act($1) r`, [JSON.stringify(action)]))[0].r
    battle = result.battle
  }
  check('a full battle ends', battle.status !== 'playing' && ['a', 'd', 'draw'].includes(battle.winner))
  check('the log names attacks', battle.log.some((e) => e.k === 'attack' && typeof e.attack === 'string'))
  check('its cards are shown once over, coins for a paid win', battle.them.cards.length === 20
    && (battle.status !== 'won' || battle.coins === 10))
  check('nothing in progress after', (await q(`select pvp_state() s`))[0].s.battle === null)
  check('acting with no battle', (await errorOf(`select pvp_act('{"type":"end"}')`)).includes('no_game'))

  // A player battle against Misty's deck, given up
  await as(misty)
  await errorOf(`select pvp_save_deck('all', $1)`, [DECK])
  await asAdmin()
  await q(`insert into pvp_decks (user_id, format, role, card_ids) values ($1, 'all', 'defense', $2)`, [misty, DECK])
  await as(bazouk)
  state = (await q(`select pvp_start('all') s`))[0].s
  check('a player battle: against Misty, setup first', state.battle.opponent.username === 'Misty' && state.battle.phase === 'setup')
  result = (await q(`select pvp_forfeit() r`))[0].r
  check('giving up loses Elo', result.battle.status === 'forfeit' && result.battle.elo_change < 0)

  // Internals stay internal
  check('players cannot call the engine', (await errorOf(`select pvp_game_new('[]', '[]', 'easy')`)) !== ''
    && (await errorOf(`select pvp_do('{}', 'a', '{}')`)) !== '' && (await errorOf(`select pvp_bot_deck('all', 'hard')`)) !== '')
}
