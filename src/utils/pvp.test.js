import { describe, expect, it } from 'vitest'
import {
  addBlock,
  addCard,
  attackChoices,
  attackName,
  attackText,
  autoDeck,
  botCoins,
  damageLabel,
  deckCheck,
  deckCounts,
  deckRoles,
  eloChange,
  hpPercent,
  parseFormat,
  prizesFor,
  pvpOpenTo,
  record,
  removeCard,
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
    expect(deckCheck(['pika1', 'raichu', 'zard'], map)).toEqual({ ready: false, missing: 17, basics: 1, orphans: ['Charizard'] })
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
  it('lets the testers in, whatever the case, everyone with null', () => {
    expect(pvpOpenTo('Bazouk')).toBe(true)
    expect(pvpOpenTo('BAZOUK')).toBe(true)
    expect(pvpOpenTo('Ash')).toBe(false)
    expect(pvpOpenTo(null)).toBe(false)
    expect(pvpOpenTo('Ash', null)).toBe(true)
  })
})
