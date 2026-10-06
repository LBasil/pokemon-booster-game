// 0033: Pokémon abilities in PvP (active, passive, on_bench / on_evolve), like Pokémon TCG Pocket
import { addUsers, freshDb, helpers, migrationFiles, readMigration } from './harness.mjs'
import { abilityData } from '../../src/utils/abilityEffects.js'

// Real texts (pokemontcg.io), parsed like populate.mjs does
const ABILITIES = {
  shaymin: ['Set Up', 'When you play this Pokémon from your hand onto your Bench, you may draw cards until you have 6 cards in your hand.'],
  oranguru: ['Instruct', 'Once during your turn (before your attack), you may draw cards until you have 3 cards in your hand.'],
  alcremie: ['Confectionary Gift', 'Once during your turn, you may heal 30 damage from 1 of your Pokémon.'],
  snorlax: ['Gormandize', 'Once during your turn, if this Pokémon is in the Active Spot, you may draw cards until you have 7 cards in your hand. If you use this Ability, your turn ends.'],
  jangmoo: ['Bulletproof', 'This Pokémon takes 10 less damage from attacks (after applying Weakness and Resistance).'],
  druddigon: ['Rough Skin', "If this Pokémon is your Active Pokémon and is damaged by an opponent's attack (even if this Pokémon is Knocked Out), put 2 damage counters on the Attacking Pokémon."],
  bidoof: ['Carefree Countenance', "As long as this Pokémon is on your Bench, prevent all damage done to this Pokémon by attacks (both yours and your opponent's)."],
  sturdy: ['Sturdy', 'If this Pokémon has full HP and would be Knocked Out by damage from an attack, it is not Knocked Out, and its remaining HP becomes 10.'],
  hypno: ['Sleep Pendulum', 'Once during your turn (before your attack), you may flip a coin. If heads, the Defending Pokémon is now Asleep. This power can\'t be used if Hypno is affected by a Special Condition.'],
  umbreon: ['Dark Signal', "When you play this Pokémon from your hand to evolve 1 of your Pokémon during your turn, you may switch 1 of your opponent's Benched Pokémon with their Active Pokémon."],
  team: ['Hustle Step', 'Your Basic Pokémon in play have no Retreat Cost.'],
  pinner: ['Pin', "Once during your turn, you may put 1 damage counter on 1 of your opponent's Pokémon."],
  immune: ['Clear Body', "This Pokémon can't be affected by any Special Conditions."],
}

export default async function (check) {
  const db = await freshDb('0032')
  const { q, as, asAdmin, errorOf } = helpers(db)
  const [bazouk] = await addUsers(db, 'Bazouk')
  const file = migrationFiles().find((f) => f.startsWith('0033'))
  await db.exec(readMigration(file))
  await db.exec(readMigration(file))

  await db.exec(`insert into sets (id, name, release_date, series) values ('base1', 'Base', '1999-01-09', 'Base')`)
  const attack = (name, base, fx = []) => ({ name, damage: String(base || ''), base, cost: 1, energy: ['Colorless'], text: '', fx, coins: null, partial: false })
  const card = (id, name, { hp = 60, stage = 'Basic', from = null, retreat = 1, ability, attacks } = {}) =>
    q(`insert into cards (id, name, supertype, subtypes, hp, types, weaknesses, evolves_from, retreat_cost, attacks, abilities, image_small, set_id)
       values ($1, $2, 'Pokémon', $3, $4, '{Fire}', '{Water}', $5, $6, $7, $8, 'img', 'base1')`,
      [id, name, [stage], hp, from, retreat, JSON.stringify(attacks ?? [attack('Hit', 30)]),
        ability ? JSON.stringify([abilityData({ name: ABILITIES[ability][0], text: ABILITIES[ability][1], type: 'Ability' }, name)]) : null])
  await card('plain', 'Rattata')
  await card('big', 'Machamp', { hp: 120, attacks: [attack('Smash', 100), attack('Quake', 10, [{ op: 'bench_each', n: 20 }]), attack('Toxic', 0, [{ op: 'status', status: 'poisoned', target: 'opp' }])] })
  for (const key of Object.keys(ABILITIES)) {
    if (key === 'umbreon') continue
    await card(key, key[0].toUpperCase() + key.slice(1), { ability: key, hp: key === 'sturdy' ? 70 : 60 })
  }
  await card('eevee', 'Eevee')
  await card('umbreon', 'Umbreon', { stage: 'Stage 1', from: 'Eevee', hp: 100, ability: 'umbreon' })
  await card('heavy', 'Snorlax Heavy', { retreat: 3 })

  await asAdmin()
  const one = async (sql, params) => Object.values((await q(sql, params))[0])[0]
  const ids = ['plain', 'big', ...Object.keys(ABILITIES).filter((k) => k !== 'umbreon'), 'eevee', 'umbreon', 'heavy', 'plain', 'plain', 'plain', 'plain']
  const cards = await one(`select jsonb_agg(pvp_card(i) order by n) from unnest($1::text[]) with ordinality x(i, n)`, [ids])
  const idx = (id) => ids.indexOf(id)
  const fill = ids.map((_, i) => i).filter((i) => ids[i] === 'plain').slice(1)

  check('an ability carries its kind and effects', cards[idx('oranguru')].abilities[0].kind === 'active'
    && cards[idx('oranguru')].abilities[0].fx[0].op === 'draw_until' && cards[idx('jangmoo')].abilities[0].kind === 'passive')

  const base = await one(`select pvp_game_new($1, '["Fire"]', $1, '["Fire"]', 'hard')`, [JSON.stringify(cards)])
  const slot = (c, extra = {}) => ({ c, under: [], damage: 0, energy: 1, etypes: ['Fire'], turn_in: 0, status: null, status_turn: null, poisoned: false, burned: false,
    lock_attack: null, no_retreat: null, reduce: null, prevent: null, smoke: null, weaken: null, tool: null, ...extra })
  const board = ({ turn = 3, me, bench = [], hand = [], deck = fill, them, theirBench = [] }) => ({
    ...base, turn, phase: 'play', stage: 'play', current: 'a', events: [], promote: [], winner: null,
    a: { ...base.a, active: me, bench, hand, deck, discard: [], points: 0, attached: false, retreated: false, used_once: false, zone: 'Fire', next: 'Fire' },
    d: { ...base.d, active: them, bench: theirBench, hand: [], deck: [idx('plain')], discard: [], points: 0, attached: false, retreated: false, used_once: false, zone: null, next: 'Fire' },
  })
  const run = (g, action, side = 'a') => one(`select pvp_do($1, $2, $3)`, [JSON.stringify(g), side, JSON.stringify(action)])
  const fails = (g, action) => errorOf(`select pvp_do($1, 'a', $2)`, [JSON.stringify(g), JSON.stringify(action)])
  const hints = (g) => one(`select pvp_hints($1)`, [JSON.stringify(g)])

  // On bench
  let g = board({ me: slot(idx('plain')), hand: [idx('shaymin')], them: slot(idx('plain')) })
  g = await run(g, { type: 'bench', card: idx('shaymin') })
  check('Set Up: benched from my hand, it draws up to 6', g.a.hand.length === Math.min(6, fill.length) && g.events.some((e) => e.k === 'ability' && e.ability === 'Set Up'))

  // Active, once a turn
  g = board({ me: slot(idx('oranguru')), them: slot(idx('plain')) })
  check('a usable ability shows in the hints', (await hints(g)).abilities['0'][0] === null)
  g = await run(g, { type: 'ability', at: 0, ability: 0 })
  check('Instruct draws up to 3', g.a.hand.length === 3)
  check('once a turn', (await hints(g)).abilities['0'][0] === 'used' && (await fails(g, { type: 'ability', at: 0, ability: 0 })).includes('used'))
  check('again next turn', (await hints({ ...g, turn: 5, a: { ...g.a, hand: [] } })).abilities['0'][0] === null)

  g = board({ me: slot(idx('plain'), { damage: 40 }), bench: [slot(idx('alcremie'))], them: slot(idx('plain')) })
  g = await run(g, { type: 'ability', at: 1, ability: 0 })
  check('Confectionary Gift heals 30 from the most damaged by default', g.a.active.damage === 10)

  g = board({ me: slot(idx('plain')), bench: [slot(idx('snorlax'))], them: slot(idx('plain')) })
  check('Gormandize only from the Active Spot', (await hints(g)).abilities['1'][0] === 'not_active')
  g = board({ me: slot(idx('snorlax')), them: slot(idx('plain')) })
  g = await run(g, { type: 'ability', at: 0, ability: 0 })
  check('and it ends my turn', g.stage === 'end' && g.a.hand.length === Math.min(7, fill.length))

  g = board({ me: slot(idx('hypno'), { status: 'confused' }), them: slot(idx('plain')) })
  check('a Poké-Power not under a Special Condition', (await hints(g)).abilities['0'][0] === 'status')

  g = board({ me: slot(idx('pinner')), them: slot(idx('plain')), theirBench: [slot(idx('big'))] })
  g = await run(g, { type: 'ability', at: 0, ability: 0, target: 1 })
  check('a damage counter on the Pokémon I picked', g.d.bench[0].damage === 10 && g.d.active.damage === 0)

  // Passive
  g = board({ me: slot(idx('plain')), them: slot(idx('jangmoo')) })
  g = await run(g, { type: 'attack', attack: 0 })
  check('Bulletproof: 30 - 10', g.d.active.damage === 20)
  g = board({ me: slot(idx('plain')), them: slot(idx('druddigon')) })
  g = await run(g, { type: 'attack', attack: 0 })
  check('Rough Skin: 20 back on the attacker', g.a.active.damage === 20)
  g = board({ me: slot(idx('big')), them: slot(idx('plain')), theirBench: [slot(idx('bidoof')), slot(idx('plain'))] })
  g = await run(g, { type: 'attack', attack: 1 })
  check('Carefree Countenance: no damage on the Bench', g.d.bench[0].damage === 0 && g.d.bench[1].damage === 20)
  g = board({ me: slot(idx('big')), them: slot(idx('sturdy')), theirBench: [slot(idx('plain'))] })
  g = await run(g, { type: 'attack', attack: 0 })
  check('Sturdy: full HP, it stays at 10', g.d.active.damage === 60 && g.a.points === 0)
  g = board({ me: slot(idx('big')), them: slot(idx('immune')) })
  g = await run(g, { type: 'attack', attack: 2 })
  check("Clear Body: can't be Poisoned", g.d.active.poisoned === false)
  g = board({ me: slot(idx('heavy'), { energy: 0, etypes: [] }), bench: [slot(idx('team')), slot(idx('plain'))], them: slot(idx('plain')) })
  check('Basics without retreat cost with Hustle Step in play', (await hints(g)).retreat_cost === 0 && (await hints(g)).abilities['1'][0] === 'passive')

  // On evolve
  g = board({ me: slot(idx('eevee')), hand: [idx('umbreon')], them: slot(idx('plain')), theirBench: [slot(idx('big'))] })
  g = await run(g, { type: 'evolve', card: idx('umbreon'), pos: 0 })
  check('Dark Signal: evolving brings their Benched Pokémon in', g.d.active.c === idx('big'))

  // The AI
  g = board({ turn: 4, me: slot(idx('plain')), them: slot(idx('oranguru')) })
  g = await one(`select pvp_run($1)`, [JSON.stringify({ ...g, current: 'd', stage: 'start', d: { ...g.d, hand: [], deck: [idx('plain'), idx('plain'), idx('plain'), idx('plain')] } })])
  check('the server uses its abilities', g.events.some((e) => e.k === 'ability' && e.s === 'd'))

  // Through the RPCs
  const DECK = ['oranguru', 'oranguru', 'alcremie', 'alcremie', 'jangmoo', 'jangmoo', 'druddigon', 'druddigon', 'shaymin', 'shaymin',
    'pinner', 'pinner', 'immune', 'immune', 'plain', 'plain', 'big', 'big', 'sturdy', 'sturdy']
  for (const id of new Set(DECK)) await q(`insert into collections (user_id, mode, card_id, quantity) values ($1, 'challenge', $2, 2)`, [bazouk, id])
  await as(bazouk)
  await one(`select pvp_save_deck('all', $1, 'attack', '{Fire}')`, [DECK])
  let battle = (await one(`select pvp_bot_start('all', 'normal')`)).battle
  const basics = battle.me.hand.filter((h) => h.card.stage === 'basic').map((h) => h.index)
  let result = await one(`select pvp_act($1)`, [JSON.stringify({ type: 'setup', active: basics[0], bench: basics.slice(1, 3) })])
  battle = result.battle
  let used = 0
  for (let moves = 0; battle.status === 'playing' && moves < 400; moves++) {
    let action
    const usable = Object.entries(battle.hints.abilities ?? {}).flatMap(([pos, list]) => list.map((b, i) => (b === null ? { at: Number(pos), ability: i } : null))).filter(Boolean)
    const benchable = Object.entries(battle.hints.hand ?? {}).filter(([, h]) => h.bench).map(([i]) => Number(i))
    if (battle.phase === 'promote') action = { type: 'promote', pos: 1 }
    else if (usable.length && used < 20) action = { type: 'ability', ...usable[0] }
    // Bench every Basic: an opening hand without the ability holders left them in hand all game
    else if (benchable.length) action = { type: 'bench', card: benchable[0] }
    else if (battle.hints.attach) action = { type: 'attach', pos: 0 }
    else if (battle.hints.attacks.some((b) => b === null)) action = { type: 'attack', attack: battle.hints.attacks.indexOf(null) }
    else action = { type: 'end' }
    if (action.type === 'ability') used++
    try {
      battle = (await one(`select pvp_act($1)`, [JSON.stringify(action)])).battle
    } catch (err) {
      console.log('ACT FAILED', JSON.stringify(action), err.message)
      break
    }
  }
  check('a battle with abilities ends', battle.status !== 'playing' && used > 0)
  check('abilities are named in the log', battle.log.some((e) => e.k === 'ability' && typeof e.ability === 'string'))
  check('players cannot call the ability engine', (await errorOf(`select pvp_ability('{}', 'a', 0, 0, '{}')`)) !== '')
}
