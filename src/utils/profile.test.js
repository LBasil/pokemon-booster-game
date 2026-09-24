import { describe, expect, it } from 'vitest'
import { achievements, boostersOpened, rankFor, rarityBreakdown, validateUsername } from './profile'

const entry = (id, rarity, quantity = 1, value = 0) => ({
  card_id: id,
  quantity,
  cards: { id, rarity, value, set_id: id.split('-')[0] },
})

describe('boostersOpened', () => {
  it('is cards pulled divided by 10, rounded down', () => {
    expect(boostersOpened(0)).toBe(0)
    expect(boostersOpened(119)).toBe(11)
  })
})

describe('rankFor', () => {
  it('starts as a rookie heading for trainer', () => {
    const { rank, next, progress, level } = rankFor(0)
    expect([rank.id, next.id, progress, level]).toEqual(['rookie', 'trainer', 0, 1])
  })

  it('tracks progress between two ranks', () => {
    const { rank, next, progress } = rankFor(30)
    expect([rank.id, next.id, progress]).toEqual(['trainer', 'collector', 0.5])
  })

  it('caps at legend', () => {
    const { rank, next, progress } = rankFor(5000)
    expect([rank.id, next, progress]).toEqual(['legend', null, 1])
  })
})

describe('rarityBreakdown', () => {
  it('counts unique cards per bucket', () => {
    const entries = [entry('a-1', 'Common', 3), entry('a-2', 'Double Rare'), entry('a-3', 'Hyper Rare')]
    expect(rarityBreakdown(entries)).toEqual({ common: 1, uncommon: 0, rare: 0, holo: 1, ultra: 0, secret: 1 })
  })
})

describe('achievements', () => {
  const sets = [
    { id: 'base1', total: 2, release_date: '1999-01-09' },
    { id: 'sv3pt5', total: 207, release_date: '2023-09-22' },
  ]
  const byId = (list) => Object.fromEntries(list.map((a) => [a.id, a]))

  it('unlocks from the collection contents', () => {
    const entries = [entry('base1-1', 'Rare Holo', 6, 400), entry('base1-2', 'Common', 5, 1), entry('sv3pt5-199', 'Special Illustration Rare', 1, 700)]
    const a = byId(achievements(entries, sets))
    expect(a.firstBooster.unlocked).toBe(true) // 12 cards = 1 booster
    expect(a.tenBoosters).toMatchObject({ unlocked: false, current: 1, target: 10 })
    expect(a.firstSecret.unlocked).toBe(true)
    expect(a.completeSet.unlocked).toBe(true) // base1: 2/2 in this fixture
    expect(a.vintage.unlocked).toBe(true)
    expect(a.bigValue).toMatchObject({ unlocked: true, current: 1000 }) // 2400 + 5 + 700, capped
  })

  it('is all locked for an empty collection', () => {
    expect(achievements([], sets).every((a) => !a.unlocked)).toBe(true)
  })
})

describe('validateUsername', () => {
  it('trims and checks the length', () => {
    expect(validateUsername(' a ')).toBe('tooShort')
    expect(validateUsername('x'.repeat(25))).toBe('tooLong')
    expect(validateUsername('  Sacha  ')).toBeNull()
  })
})
