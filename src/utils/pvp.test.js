import { describe, expect, it } from 'vitest'
import {
  autoDeck,
  bestDamage,
  canPay,
  damageAgainst,
  damageLabel,
  deckRoles,
  defendingDeck,
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

describe('attack and defense decks', () => {
  const deck = (valid) => ({ cards: [], valid })
  it('reads both roles, and the one deck of the 0025 server as the attack deck', () => {
    expect(deckRoles(undefined)).toEqual({ attack: null, defense: null })
    expect(deckRoles(deck(true))).toEqual({ attack: deck(true), defense: null })
    expect(deckRoles({ defense: deck(true) })).toEqual({ attack: null, defense: deck(true) })
  })

  it('defends with the defense deck while valid, else the attack deck', () => {
    expect(defendingDeck({ attack: deck(true), defense: deck(true) }).role).toBe('defense')
    expect(defendingDeck({ attack: deck(true), defense: deck(false) }).role).toBe('attack')
    expect(defendingDeck({ attack: deck(true) }).role).toBe('attack')
    expect(defendingDeck(null)).toBeNull()
  })
})

describe('autoDeck', () => {
  let n = 0
  const card = (name, hp, cost, damage, { prizes = 1, type = 'Colorless', times = false } = {}) => ({
    id: `c${++n}`, name, hp, prizes, types: [type], attacks: [{ name: 'Hit', damage, cost, times }],
  })

  it('takes 5 different cards, the efficient ones first', () => {
    const pool = [
      card('Weak', 40, 3, 20),
      card('Rattata', 40, 1, 20),
      card('Pikachu', 60, 1, 30, { type: 'Lightning' }),
      card('Charmander', 70, 1, 30, { type: 'Fire' }),
      card('Squirtle', 70, 1, 30, { type: 'Water' }),
      card('Bulbasaur', 70, 1, 30, { type: 'Grass' }),
      card('Onix', 90, 2, 40, { type: 'Fighting' }),
    ]
    const ids = autoDeck(pool)
    expect(ids).toHaveLength(5)
    expect(new Set(ids).size).toBe(5)
    expect(ids).not.toContain(pool[0].id)
    expect(ids).not.toContain(pool[1].id)
  })

  it('never takes two cards of the same name', () => {
    const pool = [card('Mewtwo', 120, 1, 60), card('Mewtwo', 120, 1, 60), ...['A', 'B', 'C', 'D', 'E'].map((x) => card(x, 50, 1, 20))]
    const names = autoDeck(pool).map((id) => pool.find((c) => c.id === id).name)
    expect(names.filter((x) => x === 'Mewtwo')).toHaveLength(1)
  })

  it('keeps at most 2 cards worth 2+ prizes and 2 cheap attackers', () => {
    const big = ['V1', 'V2', 'V3', 'V4', 'V5'].map((x, i) => card(x, 220, 3, 200, { prizes: 2, type: ['Fire', 'Water', 'Grass', 'Psychic', 'Metal'][i] }))
    const cheap = ['a', 'b', 'c', 'd'].map((x) => card(x, 50, 1, 10))
    const picked = autoDeck([...big, ...cheap]).map((id) => [...big, ...cheap].find((c) => c.id === id))
    expect(picked.filter((c) => c.prizes > 1)).toHaveLength(2)
    expect(picked.filter((c) => c.attacks[0].cost <= 1).length).toBeGreaterThanOrEqual(2)
  })

  it('leans on HP per prize for defense', () => {
    const glass = card('Glass', 40, 1, 50)
    const wall = card('Wall', 160, 2, 40)
    const filler = ['a', 'b', 'c', 'd', 'e', 'f'].map((x, i) => card(x, 70, 1, 30, { type: ['Fire', 'Water', 'Grass', 'Psychic', 'Metal', 'Dragon'][i] }))
    const attack = autoDeck([glass, wall, ...filler], 'attack')
    const defense = autoDeck([glass, wall, ...filler], 'defense')
    expect(defense).toContain(wall.id)
    expect(defense.indexOf(wall.id)).toBeLessThanOrEqual(attack.includes(wall.id) ? attack.indexOf(wall.id) : 5)
  })

  it('fills what it can from a short pool', () => {
    expect(autoDeck([card('A', 50, 1, 10), card('A', 50, 1, 10)])).toHaveLength(2)
    expect(autoDeck([])).toEqual([])
  })
})
