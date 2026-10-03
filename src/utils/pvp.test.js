import { describe, expect, it } from 'vitest'
import { damageAgainst, damageLabel, eloChange, hpPercent, parseFormat, record, toggleDeckCard } from './pvp'

const fire = { damage: 30, times: false, types: ['Fire'], weaknesses: ['Water'], resistances: [] }
const water = { damage: 20, times: false, types: ['Water'], weaknesses: ['Lightning'], resistances: ['Fire'] }
const grass = { damage: 100, times: false, types: ['Grass'], weaknesses: ['Fire'], resistances: [] }
const flips = { damage: 30, times: true, types: ['Lightning'], weaknesses: [], resistances: [] }

describe('damageAgainst', () => {
  it('deals the printed damage', () => {
    expect(damageAgainst(grass, water)).toBe(100)
  })

  it('doubles on a weakness', () => {
    expect(damageAgainst(water, fire)).toBe(40)
    expect(damageAgainst(fire, grass)).toBe(60)
  })

  it('takes 30 off on a resistance, never under 10', () => {
    expect(damageAgainst(fire, water)).toBe(10)
  })

  it('multiplies a "×" attack by the roll', () => {
    expect(damageAgainst(flips, grass, 3)).toBe(90)
    expect(damageAgainst(flips, water, 2)).toBe(120)
    expect(damageAgainst(grass, water, 3)).toBe(100)
  })
})

describe('eloChange', () => {
  it('moves 16 between equals', () => {
    expect(eloChange(1000, 1000, 1)).toBe(16)
    expect(eloChange(1000, 1000, 0)).toBe(-16)
    expect(eloChange(1000, 1000, 0.5)).toBe(0)
  })

  it('pays more for beating a stronger player', () => {
    expect(eloChange(1000, 1200, 1)).toBe(24)
    expect(eloChange(1200, 1000, 1)).toBe(8)
  })
})

describe('record', () => {
  it('adds attacks and defenses', () => {
    expect(record({ wins: 2, losses: 1, draws: 0, def_wins: 1, def_losses: 0, def_draws: 1 })).toEqual({ wins: 3, losses: 1, draws: 1, total: 5, rate: 60 })
  })

  it('has no rate before a battle', () => {
    expect(record(undefined).rate).toBeNull()
  })
})

describe('parseFormat', () => {
  it('reads the three kinds', () => {
    expect(parseFormat('all')).toEqual({ kind: 'all', value: null })
    expect(parseFormat('era:Scarlet & Violet')).toEqual({ kind: 'era', value: 'Scarlet & Violet' })
    expect(parseFormat('set:base1')).toEqual({ kind: 'set', value: 'base1' })
    expect(parseFormat('nonsense')).toEqual({ kind: 'all', value: null })
  })
})

describe('toggleDeckCard', () => {
  it('adds until the deck is full, removes a picked card', () => {
    expect(toggleDeckCard(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleDeckCard(['a', 'b'], 'a')).toEqual(['b'])
    expect(toggleDeckCard(['a', 'b', 'c', 'd', 'e'], 'f')).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})

describe('labels', () => {
  it('prints damage and HP bars', () => {
    expect(damageLabel(flips)).toBe('30×')
    expect(damageLabel(grass)).toBe('100')
    expect(hpPercent({ hp: 200, hp_left: 50 })).toBe(25)
    expect(hpPercent({ hp: 60 })).toBe(100)
  })
})
