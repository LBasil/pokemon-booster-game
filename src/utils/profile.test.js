import { describe, expect, it } from 'vitest'
import { boostersOpened, rankFor, rarityBreakdown, validateUsername } from './profile'

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

describe('validateUsername', () => {
  it('trims and checks the length', () => {
    expect(validateUsername(' a ')).toBe('tooShort')
    expect(validateUsername('x'.repeat(25))).toBe('tooLong')
    expect(validateUsername('  Sacha  ')).toBeNull()
  })
})
