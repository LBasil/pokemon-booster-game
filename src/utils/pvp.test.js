import { describe, expect, it } from 'vitest'
import {
  bestDamage,
  canPay,
  damageAgainst,
  damageLabel,
  eloChange,
  energyAfter,
  hpPercent,
  parseFormat,
  prizesFor,
  record,
  toggleDeckCard,
} from './pvp'

const fire = { types: ['Fire'], weaknesses: ['Water'], resistances: [] }
const water = { types: ['Water'], weaknesses: ['Lightning'], resistances: ['Fire'] }
const grass = { types: ['Grass'], weaknesses: ['Fire'], resistances: [] }
const lightning = { types: ['Lightning'], weaknesses: [], resistances: [] }
const ember = { damage: 30, times: false, cost: 1 }
const bubble = { damage: 20, times: false, cost: 1 }
const solar = { damage: 100, times: false, cost: 4 }
const flips = { damage: 30, times: true, cost: 2 }

describe('prizesFor', () => {
  it('follows the rule boxes', () => {
    expect(prizesFor(['Basic'])).toBe(1)
    expect(prizesFor(['Basic', 'ex'])).toBe(2)
    expect(prizesFor(['MEGA', 'EX'])).toBe(2)
    expect(prizesFor(['VMAX'])).toBe(3)
    expect(prizesFor(['Basic', 'TAG TEAM', 'GX'])).toBe(3)
    expect(prizesFor(['Stage 1', 'MEGA', 'ex'])).toBe(3)
    expect(prizesFor()).toBe(1)
  })
})

describe('damageAgainst', () => {
  it('deals the printed damage', () => {
    expect(damageAgainst(grass, solar, water)).toBe(100)
  })

  it('doubles on a weakness', () => {
    expect(damageAgainst(water, bubble, fire)).toBe(40)
    expect(damageAgainst(fire, ember, grass)).toBe(60)
  })

  it('takes 30 off on a resistance, never under 10', () => {
    expect(damageAgainst(fire, ember, water)).toBe(10)
  })

  it('multiplies a "×" attack by the roll', () => {
    expect(damageAgainst(lightning, flips, grass, 3)).toBe(90)
    expect(damageAgainst(lightning, flips, water, 2)).toBe(120)
  })

  it('deals nothing without an attack', () => {
    expect(damageAgainst(fire, null, grass)).toBe(0)
  })
})

describe('energy', () => {
  it('pays the cost, then adds 1, up to 5', () => {
    expect(energyAfter(1, ember)).toBe(1)
    expect(energyAfter(1, null)).toBe(2)
    expect(energyAfter(4, solar)).toBe(1)
    expect(energyAfter(5, null)).toBe(5)
  })

  it('says what can be paid for', () => {
    expect(canPay(solar, 3)).toBe(false)
    expect(canPay(solar, 4)).toBe(true)
    expect(canPay(null, 0)).toBe(true)
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
  it('prints damage, best damage and HP bars', () => {
    expect(damageLabel(flips)).toBe('30×')
    expect(damageLabel(solar)).toBe('100')
    expect(bestDamage({ attacks: [ember, solar] })).toBe(100)
    expect(bestDamage({})).toBe(0)
    expect(hpPercent({ hp: 200, hp_left: 50 })).toBe(25)
    expect(hpPercent({ hp: 60 })).toBe(100)
  })
})
