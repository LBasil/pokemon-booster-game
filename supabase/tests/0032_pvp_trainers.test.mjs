// 0032: Trainer cards in PvP (Items, 1 Supporter a turn, Tools), like Pokémon TCG Pocket
import { addUsers, freshDb, helpers, migrationFiles, readMigration } from './harness.mjs'
import { trainerData } from '../../src/utils/trainerEffects.js'

const ITEM = 'You may play any number of Item cards during your turn.'
const SUPPORTER = 'You may play only 1 Supporter card during your turn.'
const TOOL = 'Attach a Pokémon Tool to 1 of your Pokémon that doesn\'t already have a Pokémon Tool attached.'
// Real texts (pokemontcg.io), parsed like populate.mjs does
const TRAINERS = {
  potion: ['Potion', ['Item'], ['Heal 30 damage from 1 of your Pokémon.', ITEM]],
  research: ["Professor's Research", ['Supporter'], ['Discard your hand and draw 7 cards.', SUPPORTER]],
  boss: ["Boss's Orders", ['Supporter'], ["Switch 1 of your opponent's Benched Pokémon with their Active Pokémon.", SUPPORTER]],
  switch: ['Switch', ['Item'], ['Switch your Active Pokémon with 1 of your Benched Pokémon.', ITEM]],
  nest: ['Nest Ball', ['Item'], ['Search your deck for a Basic Pokémon and put it onto your Bench. Then, shuffle your deck.', ITEM]],
  candy: ['Rare Candy', ['Item'], ['Choose 1 of your Basic Pokémon in play. If you have a Stage 2 card in your hand that evolves from that Pokémon, put that card onto the Basic Pokémon to evolve it, skipping the Stage 1. You can\'t use this card during your first turn or on a Basic Pokémon that was put into play this turn.', ITEM]],
  ultra: ['Ultra Ball', ['Item'], ['Discard 2 cards from your hand. If you do, search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.', ITEM]],
  band: ['Muscle Band', ['Pokémon Tool'], [TOOL, 'The attacks of the Pokémon this card is attached to do 20 more damage to your opponent\'s Active Pokémon (before applying Weakness and Resistance).', ITEM]],
  helmet: ['Rocky Helmet', ['Pokémon Tool'], [TOOL, 'If the Pokémon this card is attached to is in the Active Spot and is damaged by an attack from your opponent\'s Pokémon (even if it is Knocked Out), put 2 damage counters on the Attacking Pokémon.', ITEM]],
  charm: ['Big Charm', ['Pokémon Tool'], [TOOL, 'The Pokémon this card is attached to gets +30 HP.', ITEM]],
  stone: ['Float Stone', ['Pokémon Tool'], [TOOL, 'The Pokémon this card is attached to has no Retreat Cost.', ITEM]],
  cape: ["Hero's Cape", ['Pokémon Tool', 'ACE SPEC'], [TOOL, 'The Pokémon this card is attached to gets +100 HP.', 'ACE SPEC: You can\'t have more than 1 ACE SPEC card in your deck.']],
  cape2: ['Master Ball', ['Item', 'ACE SPEC'], ['Search your deck for a Pokémon, reveal it, and put it into your hand. Then, shuffle your deck.', 'ACE SPEC: You can\'t have more than 1 ACE SPEC card in your deck.']],
  leon: ['Leon', ['Supporter'], ["During this turn, your Pokémon's attacks do 30 more damage to your opponent's Active Pokémon (before applying Weakness and Resistance).", SUPPORTER]],
  stadium: ['Path to the Peak', ['Stadium'], ['Pokémon with a Rule Box in play (both yours and your opponent\'s) have no Abilities.']],
}

export default async function (check) {
  const db = await freshDb('0031')
  const { q, as, asAdmin, errorOf } = helpers(db)
  const [bazouk] = await addUsers(db, 'Bazouk')
  const file = migrationFiles().find((f) => f.startsWith('0032'))
  await db.exec(readMigration(file))
  await db.exec(readMigration(file))

  await db.exec(`insert into sets (id, name, release_date, series) values ('base1', 'Base', '1999-01-09', 'Base')`)
  const attack = (name, base, energy) => ({ name, damage: String(base || ''), base, cost: energy.length, energy, text: '', fx: [], coins: null, partial: false })
  const card = (id, name, { hp = 60, type = 'Fire', weak = 'Water', stage = 'Basic', from = null, retreat = 1, attacks } = {}) =>
    q(`insert into cards (id, name, supertype, subtypes, hp, types, weaknesses, evolves_from, retreat_cost, attacks, image_small, set_id)
       values ($1, $2, 'Pokémon', $3, $4, $5, $6, $7, $8, $9, 'img', 'base1')`,
      [id, name, [stage], hp, [type], weak ? [weak] : null, from, retreat, JSON.stringify(attacks ?? [attack('Ember', 30, ['Colorless'])])])
  await card('charmander', 'Charmander')
  await card('charmeleon', 'Charmeleon', { hp: 90, stage: 'Stage 1', from: 'Charmander' })
  await card('charizard', 'Charizard', { hp: 150, stage: 'Stage 2', from: 'Charmeleon', retreat: 3, attacks: [attack('Fire Spin', 100, ['Colorless'])] })
  for (let i = 1; i <= 6; i++) await card(`squirtle${i}`, `Squirtle ${i}`, { type: 'Water', weak: 'Lightning', hp: 70 })
  for (const [id, [name, subtypes, rules]] of Object.entries(TRAINERS)) {
    await q(`insert into cards (id, name, supertype, subtypes, trainer, image_small, set_id) values ($1, $2, 'Trainer', $3, $4, 'img', 'base1')`,
      [id, name, subtypes, JSON.stringify(trainerData({ subtypes, rules }))])
  }

  await asAdmin()
  const one = async (sql, params) => Object.values((await q(sql, params))[0])[0]
  const snap = (id) => one(`select pvp_card($1)`, [id])

  // ---------- Cards ----------
  const potion = await snap('potion')
  check('a playable Trainer is a card of the battles', potion.stage === 'trainer' && potion.kind === 'item' && potion.fx[0].op === 'heal' && potion.text.includes('Heal 30'))
  check('a Stadium is not (yet)', (await snap('stadium')) === null)
  check('a Stage 2 knows the Basic of its line (Rare Candy)', (await snap('charizard')).base_name === 'Charmander' && (await snap('charmeleon')).base_name === null)

  // ---------- Decks ----------
  const POKEMON = ['charmander', 'charmander', 'charmeleon', 'charizard', 'squirtle1', 'squirtle1', 'squirtle2', 'squirtle2', 'squirtle3', 'squirtle3',
    'squirtle4', 'squirtle4']
  const DECK = [...POKEMON, 'potion', 'potion', 'research', 'boss', 'switch', 'nest', 'candy', 'band']
  for (const id of [...new Set([...DECK, 'ultra', 'helmet', 'charm', 'stone', 'cape', 'cape2', 'leon'])]) {
    await q(`insert into collections (user_id, mode, card_id, quantity) values ($1, 'challenge', $2, 2)`, [bazouk, id])
  }
  const valid = async (ids) => (await one(`select pvp_deck_cards($1, 'all', $2)`, [bazouk, ids])) !== null
  check('a deck with Trainers is valid', await valid(DECK))
  check('3 copies of a Trainer are not', !(await valid([...POKEMON.slice(0, 11), 'potion', 'potion', 'potion', 'research', 'boss', 'switch', 'nest', 'candy', 'band'])))
  check('2 ACE SPEC are not', !(await valid([...DECK.slice(0, 18), 'cape', 'cape2'])))
  check('a Stadium is not', !(await valid([...DECK.slice(0, 19), 'stadium'])))
  await as(bazouk)
  const eligible = await one(`select pvp_eligible('all')`)
  check('my Trainers are eligible', eligible.some((c) => c.id === 'boss' && c.stage === 'trainer') && !eligible.some((c) => c.id === 'stadium'))
  check('they count in the formats', (await one(`select pvp_state()`)).formats.all >= 30)

  // ---------- The engine ----------
  await asAdmin()
  const ids = [...DECK, 'ultra', 'helmet', 'charm', 'stone', 'leon']
  const cards = await one(`select jsonb_agg(pvp_card(i) order by n) from unnest($1::text[]) with ordinality x(i, n)`, [ids])
  const idx = (id, nth = 0) => ids.map((x, i) => [x, i]).filter(([x]) => x === id)[nth][1]
  const base = await one(`select pvp_game_new($1, '["Fire"]', $1, '["Fire"]', 'hard')`, [JSON.stringify(cards)])
  const slot = (c, extra = {}) => ({ c, under: [], damage: 0, energy: 0, etypes: [], turn_in: 0, status: null, status_turn: null, poisoned: false, burned: false,
    lock_attack: null, no_retreat: null, reduce: null, prevent: null, smoke: null, weaken: null, tool: null, ...extra })
  const typed = (n) => ({ etypes: Array(n).fill('Fire'), energy: n })
  const board = ({ turn = 3, me, bench = [], hand = [], deck = [], discard = [], them, theirBench = [], a = {} }) => ({
    ...base, turn, phase: 'play', stage: 'play', current: 'a', events: [], promote: [], winner: null,
    a: { ...base.a, active: me, bench, hand, deck, discard, points: 0, attached: false, retreated: false, used_once: false, zone: 'Fire', next: 'Fire', ...a },
    d: { ...base.d, active: them, bench: theirBench, hand: [0, 1], deck: [2, 3], discard: [], points: 0, attached: false, retreated: false, used_once: false, zone: null, next: 'Fire' },
  })
  const run = (g, action, side = 'a') => one(`select pvp_do($1, $2, $3)`, [JSON.stringify(g), side, JSON.stringify(action)])
  const fails = (g, action) => errorOf(`select pvp_do($1, 'a', $2)`, [JSON.stringify(g), JSON.stringify(action)])
  const hints = (g) => one(`select pvp_hints($1)`, [JSON.stringify(g)])

  let g = board({ me: slot(idx('charmander'), { damage: 40 }), hand: [idx('potion')], them: slot(idx('squirtle1')) })
  g = await run(g, { type: 'trainer', card: idx('potion'), pos: 0 })
  check('Potion heals 30 and goes to the discard pile', g.a.active.damage === 10 && g.a.hand.length === 0 && g.a.discard.includes(idx('potion')))

  g = board({ turn: 1, me: slot(idx('charmander')), hand: [idx('research'), idx('potion')], deck: [idx('squirtle1'), idx('squirtle2')], them: slot(idx('squirtle1')) })
  check('no Supporter on the first turn of the battle', (await hints(g)).hand[idx('research')].play === 'first_turn'
    && (await fails(g, { type: 'trainer', card: idx('research') })).includes('first_turn'))
  g = await run({ ...g, turn: 3 }, { type: 'trainer', card: idx('research') })
  check("Professor's Research: the hand discarded, 7 drawn (as many as the deck has)", g.a.discard.includes(idx('potion')) && g.a.hand.length === 2 && g.a.deck.length === 0)
  check('then no second Supporter this turn', g.a.supporter_used === true)
  g = { ...g, a: { ...g.a, hand: [idx('boss')] } }
  check('the second one is refused', (await fails(g, { type: 'trainer', card: idx('boss') })).includes('supporter'))

  g = board({ me: slot(idx('charmander')), hand: [idx('boss')], them: slot(idx('squirtle1')), theirBench: [slot(idx('squirtle2')), slot(idx('squirtle3'))] })
  g = await run(g, { type: 'trainer', card: idx('boss'), target: 2 })
  check("Boss's Orders brings the Pokémon I picked in", g.d.active.c === idx('squirtle3'))
  check('no Benched Pokémon of theirs: Boss has no target', (await hints(board({ me: slot(idx('charmander')), hand: [idx('boss')], them: slot(idx('squirtle1')) }))).hand[idx('boss')].play === 'no_target')

  g = board({ me: slot(idx('charmander')), bench: [slot(idx('squirtle1'))], hand: [idx('switch')], them: slot(idx('squirtle2')) })
  g = await run(g, { type: 'trainer', card: idx('switch'), to: 1 })
  check('Switch', g.a.active.c === idx('squirtle1') && g.a.bench[0].c === idx('charmander'))

  g = board({ me: slot(idx('charmander')), hand: [idx('nest')], deck: [idx('charmeleon'), idx('squirtle1')], them: slot(idx('squirtle2')) })
  g = await run(g, { type: 'trainer', card: idx('nest') })
  check('Nest Ball puts a Basic from my deck onto my Bench', g.a.bench.length === 1 && g.a.bench[0].c === idx('squirtle1') && g.a.deck.length === 1)

  g = board({ turn: 3, me: slot(idx('charmander'), { turn_in: 1 }), hand: [idx('candy'), idx('charizard')], them: slot(idx('squirtle2')) })
  g = await run(g, { type: 'trainer', card: idx('candy'), pos: 0, evolve: idx('charizard') })
  check('Rare Candy: Charmander straight to Charizard', g.a.active.c === idx('charizard') && g.a.active.under[0] === idx('charmander'))
  g = board({ turn: 3, me: slot(idx('charmander'), { turn_in: 3 }), hand: [idx('candy'), idx('charizard')], them: slot(idx('squirtle2')) })
  check('not on a Basic played this turn', (await hints(g)).hand[idx('candy')].play === 'no_target')

  g = board({ me: slot(idx('charmander')), hand: [idx('ultra'), idx('potion'), idx('switch')], deck: [idx('charizard'), idx('squirtle1')], them: slot(idx('squirtle2')) })
  check('Ultra Ball needs 2 other cards to discard', (await hints({ ...g, a: { ...g.a, hand: [idx('ultra'), idx('potion')] } })).hand[idx('ultra')].play === 'hand')
  g = await run(g, { type: 'trainer', card: idx('ultra'), discard: [idx('potion'), idx('switch')], pick: [idx('charizard')] })
  check('Ultra Ball: the 2 I picked discarded, the Pokémon I picked found', g.a.hand.join() === String(idx('charizard'))
    && g.a.discard.includes(idx('potion')) && g.a.discard.includes(idx('switch')) && g.events.some((e) => e.k === 'search'))

  // Tools
  g = board({ me: slot(idx('charmander'), typed(1)), hand: [idx('band')], them: slot(idx('squirtle1')) })
  g = await run(g, { type: 'trainer', card: idx('band'), pos: 0 })
  check('a Tool stays on the Pokémon', g.a.active.tool === idx('band') && !g.a.discard.includes(idx('band')))
  g = await run(g, { type: 'attack', attack: 0 })
  check('Muscle Band: 30 + 20', g.d.active.damage === 50)
  g = board({ me: slot(idx('charmander'), typed(1)), them: slot(idx('squirtle1'), { tool: idx('helmet') }) })
  g = await run(g, { type: 'attack', attack: 0 })
  check('Rocky Helmet: 20 back on the attacker', g.d.active.damage === 30 && g.a.active.damage === 20)
  g = board({ me: slot(idx('charmander'), typed(1)), them: slot(idx('squirtle1'), { tool: idx('charm'), damage: 70 }) })
  check('Big Charm: +30 HP', (await one(`select pvp_hp_left($1, 'd', $2)`, [JSON.stringify(g), JSON.stringify(g.d.active)])) === 30)
  g = await run(g, { type: 'attack', attack: 0 })
  check('and the Pokémon is knocked out with its Tool to the discard pile', g.a.points === 1 && g.d.discard.includes(idx('charm')))
  g = board({ me: slot(idx('charizard'), { tool: idx('stone') }), bench: [slot(idx('squirtle1'))], them: slot(idx('squirtle2')) })
  check('Float Stone: no retreat cost', (await hints(g)).retreat_cost === 0 && (await run(g, { type: 'retreat', pos: 1 })).a.active.c === idx('squirtle1'))
  g = board({ me: slot(idx('charmander'), { tool: idx('band') }), hand: [idx('helmet')], them: slot(idx('squirtle1')) })
  check('one Tool per Pokémon', (await hints(g)).hand[idx('helmet')].play === 'no_target')

  g = board({ me: slot(idx('charmander'), typed(1)), hand: [idx('leon')], them: slot(idx('squirtle1')) })
  g = await run(g, { type: 'trainer', card: idx('leon') })
  g = await run(g, { type: 'attack', attack: 0 })
  check('Leon: +30 this turn', g.d.active.damage === 60)

  // The AI plays its Trainers
  g = board({ turn: 4, me: slot(idx('squirtle1')), them: slot(idx('charmander'), { damage: 50 }) })
  g = { ...g, current: 'd', stage: 'start', d: { ...g.d, hand: [idx('potion')], deck: [idx('squirtle2')] } }
  g = await one(`select pvp_run($1)`, [JSON.stringify(g)])
  check('the server heals its damaged Active with a Potion', g.events.some((e) => e.k === 'trainer' && e.s === 'd' && e.c === idx('potion')))

  const bot = await one(`select pvp_bot_deck('all', 'normal', $1)`, [JSON.stringify(cards.slice(0, 12))])
  check('a normal bot plays 4 Trainers', bot.cards.length === 20 && bot.cards.filter((c) => c.stage === 'trainer').length === 4)

  // ---------- Through the RPCs ----------
  await as(bazouk)
  await one(`select pvp_save_deck('all', $1, 'attack', '{Fire}')`, [DECK])
  let state = await one(`select pvp_bot_start('all', 'hard')`)
  let battle = state.battle
  const basics = battle.me.hand.filter((h) => h.card.stage === 'basic').map((h) => h.index)
  let result = await one(`select pvp_act($1)`, [JSON.stringify({ type: 'setup', active: basics[0], bench: basics.slice(1, 3) })])
  battle = result.battle
  let moves = 0
  let played = 0
  while (battle.status === 'playing' && moves++ < 400) {
    let action
    const trainer = battle.me.hand.find((h) => h.card.stage === 'trainer' && battle.hints.hand[h.index]?.play === null)
    if (battle.phase === 'promote') action = { type: 'promote', pos: 1 }
    else if (trainer && played < 30) action = { type: 'trainer', card: trainer.index }
    else if (battle.hints.attach) action = { type: 'attach', pos: 0 }
    else if (battle.hints.attacks.some((b) => b === null)) action = { type: 'attack', attack: battle.hints.attacks.indexOf(null) }
    else action = { type: 'end' }
    if (action.type === 'trainer') played++
    result = await one(`select pvp_act($1)`, [JSON.stringify(action)])
    battle = result.battle
  }
  check('a battle with Trainers on both sides ends', battle.status !== 'playing' && played > 0)
  check('Trainers are named in the log', battle.log.some((e) => e.k === 'trainer' && typeof e.name === 'string'))
  check('players cannot call the Trainer engine', (await errorOf(`select pvp_trainer('{}', 'a', 0, '{}')`)) !== '')
}
