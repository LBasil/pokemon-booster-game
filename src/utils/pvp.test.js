import { describe, expect, it } from 'vitest'
import {
  addBlock,
  addCard,
  attackChoices,
  attackName,
  attackPower,
  attackText,
  attackTurns,
  autoDeck,
  autoEnergy,
  autoReference,
  botCoins,
  cardValue,
  damageLabel,
  deckCheck,
  deckCounts,
  deckEnergy,
  deckRoles,
  eloChange,
  energyMissing,
  fitsEnergy,
  matchesFilter,
  trainerScore,
  trainerSteps,
  hpPercent,
  parseFormat,
  prizesFor,
  pvpOpenTo,
  record,
  removeCard,
  validEnergy,
} from './pvp'

const attack = (base, cost, extra = {}) => ({ name: 'Hit', base, cost, printed: String(base), usable: true, fx: [], ...extra })
const card = (id, name, { stage = 'basic', from = null, hp = 60, owned = 2, attacks = [attack(20, 1)], prizes = 1 } = {}) => ({
  id,
  name,
  stage,
  evolves_from: from,
  hp,
  owned,
  attacks,
  prizes,
})

describe('prizesFor', () => {
  it('follows the rule boxes', () => {
    expect(prizesFor(['Basic'])).toBe(1)
    expect(prizesFor(['Basic', 'ex'])).toBe(2)
    expect(prizesFor(['VMAX'])).toBe(3)
    expect(prizesFor(['MEGA', 'ex'])).toBe(3)
  })
})

describe('eloChange', () => {
  it('moves 16 between equals, more for beating a stronger player', () => {
    expect(eloChange(1000, 1000, 1)).toBe(16)
    expect(eloChange(1000, 1200, 1)).toBeGreaterThan(16)
  })
})

describe('record', () => {
  it('adds attacks and defenses, no rate before a battle', () => {
    expect(record({ wins: 2, def_wins: 1, losses: 1, def_losses: 0, draws: 0, def_draws: 0 })).toEqual({ wins: 3, losses: 1, draws: 0, total: 4, rate: 75 })
    expect(record(null).rate).toBeNull()
  })
})

describe('parseFormat', () => {
  it('reads the three kinds', () => {
    expect(parseFormat('all')).toEqual({ kind: 'all', value: null })
    expect(parseFormat('era:Scarlet & Violet')).toEqual({ kind: 'era', value: 'Scarlet & Violet' })
    expect(parseFormat('set:sv3pt5')).toEqual({ kind: 'set', value: 'sv3pt5' })
  })
})

describe('deckRoles', () => {
  it('reads both roles', () => {
    expect(deckRoles({ attack: { ids: ['a'], valid: true } })).toEqual({ attack: { ids: ['a'], valid: true }, defense: null })
    expect(deckRoles(undefined)).toEqual({ attack: null, defense: null })
  })
})

describe('deck builder', () => {
  const pika = card('pika1', 'Pikachu')
  const pika2 = card('pika2', 'Pikachu')
  const rare = card('mew', 'Mew', { owned: 1 })
  const byId = new Map([pika, pika2, rare].map((c) => [c.id, c]))

  it('takes 2 of a name at most, as many as I own, 20 in all', () => {
    let ids = addCard([], pika, byId)
    ids = addCard(ids, pika2, byId)
    expect(addBlock(ids, pika, byId)).toBe('copies')
    expect(addCard(ids, pika, byId)).toEqual(ids)
    ids = addCard(ids, rare, byId)
    expect(addBlock(ids, rare, byId)).toBe('owned')
    expect(addBlock(Array(20).fill('x'), rare, byId)).toBe('full')
  })

  it('counts and removes one copy', () => {
    expect(deckCounts(['a', 'b', 'a']).get('a')).toBe(2)
    expect(removeCard(['a', 'b', 'a'], 'a')).toEqual(['a', 'b'])
    expect(removeCard(['a'], 'z')).toEqual(['a'])
  })

  it('needs 20 cards and a Basic, warns about lone evolutions', () => {
    const evo = card('raichu', 'Raichu', { stage: 'evolution', from: 'Pikachu' })
    const zard = card('zard', 'Charizard', { stage: 'evolution', from: 'Charmeleon' })
    const map = new Map([pika, evo, zard].map((c) => [c.id, c]))
    expect(deckCheck(['pika1', 'raichu', 'zard'], map)).toEqual({ ready: false, missing: 17, basics: 1, orphans: ['Charizard'], unpaid: [] })
    expect(deckCheck(Array(20).fill('raichu'), map)).toMatchObject({ ready: false, basics: 0 })
    expect(deckCheck(Array(20).fill('pika1'), map).ready).toBe(true)
  })
})

describe('autoDeck', () => {
  // A full Charmander line, a Pikachu line, a lone Stage 1 and Basics
  const pool = [
    card('charmander', 'Charmander'),
    card('charmeleon', 'Charmeleon', { stage: 'evolution', from: 'Charmander', hp: 90, attacks: [attack(50, 2)] }),
    card('charizard', 'Charizard', { stage: 'evolution', from: 'Charmeleon', hp: 150, attacks: [attack(120, 3)] }),
    card('pikachu', 'Pikachu'),
    card('raichu', 'Raichu', { stage: 'evolution', from: 'Pikachu', hp: 90, attacks: [attack(60, 2)] }),
    card('kabuto', 'Kabuto', { stage: 'evolution', from: 'Mysterious Fossil' }),
    ...Array.from({ length: 8 }, (_, i) => card(`basic${i}`, `Basic ${i}`, { attacks: [attack(10 + i * 5, 1)] })),
    card('nothing', 'Ditto', { attacks: [attack(0, 1, { usable: false })] }),
  ]
  const byId = new Map(pool.map((c) => [c.id, c]))

  it('builds 20 cards in lines, 2 of a name at most', () => {
    const ids = autoDeck(pool)
    const names = ids.map((id) => byId.get(id).name)
    expect(ids).toHaveLength(20)
    expect(Math.max(...deckCounts(names).values())).toBe(2)
    expect(names.filter((n) => n === 'Charizard')).toHaveLength(2)
    expect(names).toContain('Charmeleon')
    expect(names).toContain('Raichu')
    expect(deckCheck(ids, byId)).toMatchObject({ ready: true, orphans: [] })
  })

  it('never takes a card that cannot fight or a stuck evolution', () => {
    const ids = autoDeck(pool)
    expect(ids).not.toContain('nothing')
    expect(ids).not.toContain('kabuto')
  })

  it('respects the copies owned and fills what it can', () => {
    const few = [card('a', 'A', { owned: 1 }), card('b', 'B', { owned: 3 })]
    expect(autoDeck(few).sort()).toEqual(['a', 'b', 'b'])
  })

  it('builds around the strongest line, not the first Stage 2 (like Pocket)', () => {
    // the 0026 builder took Squirtle -> Blastoise first, whatever its stats
    const weak = [
      card('squirtle', 'Squirtle', { hp: 40, attacks: [attack(10, 1)] }),
      card('wartortle', 'Wartortle', { stage: 'evolution', from: 'Squirtle', hp: 70, attacks: [attack(30, 2)] }),
      card('blastoise', 'Blastoise', { stage: 'evolution', from: 'Wartortle', hp: 100, attacks: [attack(40, 3)] }),
    ]
    const ex = card('pikaex', 'Pikachu ex', { hp: 190, prizes: 2, attacks: [attack(200, 3)] })
    const pool = [...weak, ex, ...Array.from({ length: 8 }, (_, i) => card(`b${i}`, `Basic ${i}`, { hp: 70, attacks: [attack(30 + i * 5, 2)] }))]
    const ids = autoDeck(pool)
    expect(ids.slice(0, 2)).toEqual(['pikaex', 'pikaex'])
    expect(ids.indexOf('squirtle')).toBeGreaterThan(ids.indexOf('b7')) // the best Basic comes before it
  })

  it('makes 2 copies from two printings of a name', () => {
    const pool = [
      card('zap1', 'Zapdos', { owned: 1, hp: 120, attacks: [attack(100, 2)] }),
      card('zap2', 'Zapdos', { owned: 1, hp: 90, attacks: [attack(60, 2)] }),
      ...Array.from({ length: 6 }, (_, i) => card(`b${i}`, `Basic ${i}`)),
    ]
    expect(autoDeck(pool).slice(0, 2)).toEqual(['zap1', 'zap2'])
  })
})

describe('auto deck values', () => {
  const ref = autoReference([card('foe1', 'Foe', { hp: 60 }), card('foe2', 'Foe', { hp: 120 })])

  it('reads an attack like the AI does', () => {
    expect(attackPower(attack(20, 2, { coins: 2, fx: [{ op: 'times', n: 20 }] })).damage).toBe(40) // 2 coins, 1 heads on average
    expect(attackPower(attack(100, 2, { fx: [{ op: 'discard_self', n: 2 }] })).reuse).toBe(0.5)
    expect(attackPower(attack(30, 1, { fx: [{ op: 'status', status: 'paralyzed', target: 'opp', if: 'heads' }] })).bonus).toBe(12.5)
  })

  it('counts typed energy slower with two types', () => {
    const hit = attack(60, 2, { energy: ['Fire', 'Colorless'] })
    expect(attackTurns(hit, ['Fire'])).toBe(2)
    expect(attackTurns(hit, ['Fire', 'Water'])).toBeGreaterThan(2)
    expect(attackTurns(attack(60, 2, { energy: ['Colorless', 'Colorless'] }), ['Fire', 'Water'])).toBe(2)
  })

  it('values a knock out over chip damage, and nothing it cannot pay', () => {
    const ko = card('a', 'A', { attacks: [attack(120, 2)] })
    const half = card('b', 'B', { attacks: [attack(60, 2)] })
    expect(cardValue(ko, ['Fire'], 'attack', ref)).toBeGreaterThan(cardValue(half, ['Fire'], 'attack', ref) + 0.3)
    const water = card('w', 'W', { attacks: [attack(120, 1, { energy: ['Water'] })] })
    expect(cardValue(water, ['Fire'], 'attack', ref)).toBe(0)
  })
})

describe('typed energy', () => {
  const typed = (energy, base = 30) => attack(base, energy.length, { energy })
  it('counts what is missing (mirrors pvp_missing)', () => {
    expect(energyMissing(['Fire'], typed(['Fire', 'Colorless']))).toBe(1)
    expect(energyMissing(['Water', 'Water'], typed(['Fire']))).toBe(1)
    expect(energyMissing(['Fire', 'Water'], typed(['Fire', 'Colorless']))).toBe(0)
    expect(energyMissing(['Fire', 'Water', 'Water', 'Water'], typed(['Fire', 'Fire']))).toBe(1)
    // synced before 0031: no types, all Colorless
    expect(energyMissing(['Water'], attack(10, 1))).toBe(0)
    expect(energyMissing([], attack(10, 2))).toBe(2)
  })

  it('knows which cards an energy pays', () => {
    const zard = card('z', 'Charizard', { attacks: [typed(['Fire', 'Fire']), typed(['Colorless'], 10)] })
    const blastoise = card('b', 'Blastoise', { attacks: [typed(['Water'])] })
    expect(fitsEnergy(zard, ['Water'])).toBe(true) // its Colorless attack
    expect(fitsEnergy(blastoise, ['Fire'])).toBe(false)
    expect(fitsEnergy(blastoise, ['Fire', 'Water'])).toBe(true)
  })

  it('validates 1 or 2 known types', () => {
    expect(validEnergy(['Fire'])).toBe(true)
    expect(validEnergy(['Fire', 'Water'])).toBe(true)
    expect(validEnergy(['Fire', 'Water', 'Grass'])).toBe(false)
    expect(validEnergy(['Dragon'])).toBe(false)
    expect(validEnergy(['Fire', 'Fire'])).toBe(false)
    expect(validEnergy([])).toBe(false)
  })

  it('reads a deck\'s energy from its costs (mirrors pvp_deck_energy)', () => {
    const fire = card('f', 'Vulpix', { attacks: [typed(['Fire'])] })
    const water = card('w', 'Squirtle', { attacks: [typed(['Water'])] })
    expect(deckEnergy([fire, fire, fire, fire, fire, water])).toEqual(['Fire'])
    expect(deckEnergy([fire, fire, fire, water])).toEqual(['Fire', 'Water'])
    expect(deckEnergy([{ ...card('c', 'Rattata', { attacks: [typed(['Colorless'])] }), types: ['Colorless'] }])).toEqual(['Grass'])
  })

  it('picks the energy and the cards that go together', () => {
    const pool = [
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => card(`f${i}`, `Fire ${i}`, { attacks: [typed(['Fire'], 40)] })),
      ...[1, 2, 3].map((i) => card(`w${i}`, `Water ${i}`, { attacks: [typed(['Water'], 50)] })),
    ]
    const energy = autoEnergy(pool)
    expect(energy).toEqual(['Fire'])
    const ids = autoDeck(pool, 'attack', 20, energy)
    expect(ids).toHaveLength(20)
    expect(ids.every((id) => id.startsWith('f'))).toBe(true)
    // too few cards for the energy: the others fill the rest
    expect(autoDeck(pool, 'attack', 20, ['Water']).filter((id) => id.startsWith('w'))).toHaveLength(6)
  })

  it('warns about cards the energy never pays', () => {
    const fire = card('f', 'Vulpix', { attacks: [typed(['Fire'])] })
    const water = card('w', 'Squirtle', { attacks: [typed(['Water'])] })
    const byId = new Map([fire, water].map((c) => [c.id, c]))
    expect(deckCheck(['f', 'w'], byId, 2, ['Fire']).unpaid).toEqual(['Squirtle'])
    expect(deckCheck(['f', 'w'], byId, 2, ['Fire']).ready).toBe(true)
    expect(deckCheck(['f', 'w'], byId, 2, []).ready).toBe(false)
  })
})

describe('Trainers (0032)', () => {
  const trainer = (id, name, fx, extra = {}) => ({ id, name, stage: 'trainer', kind: 'item', fx, owned: 2, attacks: [], ...extra })
  const potion = trainer('potion', 'Potion', [{ op: 'heal', n: 30, who: 'one' }])
  const boss = trainer('boss', "Boss's Orders", [{ op: 'gust' }], { kind: 'supporter' })
  const ultra = trainer('ultra', 'Ultra Ball', [{ op: 'discard_cost', n: 2 }, { op: 'search', what: 'pokemon', n: 1, to: 'hand' }])
  const candy = trainer('candy', 'Rare Candy', [{ op: 'rare_candy' }])

  it('scores what an auto deck wants', () => {
    expect(trainerScore(boss)).toBe(3)
    expect(trainerScore(potion)).toBe(2)
    expect(trainerScore(ultra)).toBe(0) // costs cards
  })

  it('puts Trainers in an auto deck, never a Rare Candy without a Stage 2', () => {
    const pool = [
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => card(`p${i}`, `Pokémon ${i}`)),
      potion,
      boss,
      candy,
      trainer('cape', "Hero's Cape", [{ op: 'tool_hp', n: 100 }], { kind: 'tool', ace_spec: true }),
    ]
    const ids = autoDeck(pool)
    expect(ids).toHaveLength(20)
    expect(ids.filter((id) => id === 'boss')).toHaveLength(2)
    expect(ids.filter((id) => id === 'cape')).toHaveLength(1)
    expect(ids).not.toContain('candy')
    expect(ids.filter((id) => /^p\d/.test(id))).toHaveLength(15) // 5 Trainers left once Rare Candy is out
  })

  it('runs 4 lines and fills the room with Trainers, like Pocket', () => {
    // the 0032 builder filled it with single Basics: 13 names in a deck
    const pool = [
      ...Array.from({ length: 10 }, (_, i) => card(`p${i}`, `Pokémon ${i}`, { attacks: [attack(30 + i * 5, 1)] })),
      ...Array.from({ length: 6 }, (_, i) => trainer(`t${i}`, `Trainer ${i}`, [{ op: 'draw', n: 2 }])),
    ]
    const ids = autoDeck(pool)
    expect(ids).toHaveLength(20)
    expect(new Set(ids.filter((id) => id.startsWith('p')))).toEqual(new Set(['p9', 'p8', 'p7', 'p6', 'p5']))
    expect(ids.filter((id) => id.startsWith('t'))).toHaveLength(10)
    // defending: 8 Trainers, the server's AI needs Pokémon to last
    expect(autoDeck(pool, 'defense').filter((id) => id.startsWith('t'))).toHaveLength(8)
  })

  it('allows 1 ACE SPEC', () => {
    const a = trainer('a', 'Master Ball', [], { ace_spec: true })
    const b = trainer('b', "Hero's Cape", [], { ace_spec: true })
    const byId = new Map([a, b].map((c) => [c.id, c]))
    expect(addBlock(['a'], b, byId)).toBe('ace_spec')
  })

  it('never warns that a Trainer has no energy', () => {
    const byId = new Map([potion].map((c) => [c.id, c]))
    expect(deckCheck(['potion'], byId, 1, ['Fire']).unpaid).toEqual([])
  })

  it('matches search filters (mirrors pvp_matches)', () => {
    const squirtle = { stage: 'basic', types: ['Water'], hp: 60, prizes: 1 }
    const ex = { stage: 'basic', types: ['Water'], hp: 220, prizes: 2 }
    expect(matchesFilter(squirtle, { what: 'basic', type: 'Water', max_hp: 70 })).toBe(true)
    expect(matchesFilter(ex, { what: 'pokemon', no_rule_box: true })).toBe(false)
    expect(matchesFilter(boss, { what: 'supporter' })).toBe(true)
    expect(matchesFilter(boss, { what: 'pokemon' })).toBe(false)
    expect(matchesFilter(potion, { what: 'card' })).toBe(true)
  })

  it('lists the choices a Trainer asks for, the cost first', () => {
    expect(trainerSteps(potion)).toEqual(['heal'])
    expect(trainerSteps(ultra)).toEqual(['discard', 'pick'])
    expect(trainerSteps(candy)).toEqual(['candy', 'evolve'])
    expect(trainerSteps({ kind: 'tool', fx: [] })).toEqual(['tool'])
    expect(trainerSteps(boss)).toEqual(['gust'])
    // an ability's effects ask the same (0033)
    expect(trainerSteps({ fx: [{ op: 'counters', n: 10, who: 'one' }] })).toEqual(['counter'])
    expect(trainerSteps({ fx: [{ op: 'heal', n: 30, who: 'self' }] })).toEqual([])
  })
})

describe('labels', () => {
  it('prints damage, names and texts in the wanted language', () => {
    expect(damageLabel({ printed: '20×', base: 0 })).toBe('20×')
    expect(damageLabel({ printed: '', base: 0 })).toBe('')
    expect(attackName({ name: 'Ember', name_fr: 'Flammèche' }, true)).toBe('Flammèche')
    expect(attackName({ name: 'Ember', name_fr: null }, true)).toBe('Ember')
    expect(attackText({ text: 'Flip a coin.', text_fr: 'Lancez une pièce.' }, false)).toBe('Flip a coin.')
    expect(hpPercent(30, 60)).toBe(50)
    expect(hpPercent(0, 0)).toBe(0)
  })

  it('says which attacks need a choice', () => {
    expect(attackChoices({ fx: [{ op: 'bench_one', n: 20 }] })).toEqual({ target: 'bench', switchTo: false, energyTo: false })
    expect(attackChoices({ fx: [{ op: 'snipe' }, { op: 'switch_self' }] })).toEqual({ target: 'any', switchTo: true, energyTo: false })
    expect(attackChoices({})).toEqual({ target: null, switchTo: false, energyTo: false })
  })
})

describe('botCoins', () => {
  it('pays the level for a win, half for a draw, nothing else', () => {
    expect(botCoins('easy', 'won')).toBe(10)
    expect(botCoins('normal', 'draw')).toBe(12)
    expect(botCoins('hard', 'lost')).toBe(0)
    expect(botCoins('hard', 'won', false)).toBe(0)
  })
})

describe('pvpOpenTo', () => {
  it('lets everyone in since 0037, only listed testers with a list', () => {
    expect(pvpOpenTo('Ash')).toBe(true)
    expect(pvpOpenTo('BAZOUK', ['bazouk'])).toBe(true)
    expect(pvpOpenTo('Ash', ['bazouk'])).toBe(false)
    expect(pvpOpenTo(null, ['bazouk'])).toBe(false)
  })
})
