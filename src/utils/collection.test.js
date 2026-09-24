import { describe, expect, it } from 'vitest'
import { binderSlots, cardNumber, collectionStats, filterEntries, pokedexSlots, setProgress, sortEntries } from './collection'

const entry = (id, name, rarity, { quantity = 1, acquired_at = '2026-09-01', value = 0 } = {}) => ({
  card_id: id,
  quantity,
  acquired_at,
  cards: { id, name, rarity, value, set_id: id.split('-')[0] },
})

const ENTRIES = [
  entry('sv3pt5-25', 'Pikachu', 'Common', { quantity: 3, acquired_at: '2026-09-03', value: 0.2 }),
  entry('sv3pt5-199', 'Charizard ex', 'Special Illustration Rare', { acquired_at: '2026-09-01', value: 120 }),
  entry('sv3pt5-6', 'Charizard ex', 'Double Rare', { acquired_at: '2026-09-02', value: 4 }),
  entry('base1-4', 'Charizard', 'Rare Holo', { quantity: 2, acquired_at: '2026-08-01', value: 300 }),
  entry('base1-58', 'Pikachu', 'Common', { acquired_at: '2026-08-02' }),
]
const ids = (list) => list.map((e) => e.card_id)

describe('cardNumber', () => {
  it('extracts the collector number after the last dash', () => {
    expect(cardNumber('sv3pt5-173')).toBe('173')
    expect(cardNumber('swsh45sv-SV107')).toBe('SV107')
  })
})

describe('filterEntries', () => {
  it('filters by name, ignoring case and accents', () => {
    expect(ids(filterEntries(ENTRIES, { query: 'charizard' }))).toEqual(['sv3pt5-199', 'sv3pt5-6', 'base1-4'])
  })

  it('filters by set, rarity group and duplicates', () => {
    expect(ids(filterEntries(ENTRIES, { setId: 'base1' }))).toEqual(['base1-4', 'base1-58'])
    expect(ids(filterEntries(ENTRIES, { rarity: 'rare' }))).toEqual(['sv3pt5-6', 'base1-4'])
    expect(ids(filterEntries(ENTRIES, { rarity: 'secret' }))).toEqual(['sv3pt5-199'])
    expect(ids(filterEntries(ENTRIES, { duplicates: true }))).toEqual(['sv3pt5-25', 'base1-4'])
  })

  it('combines filters', () => {
    expect(ids(filterEntries(ENTRIES, { query: 'pika', setId: 'sv3pt5' }))).toEqual(['sv3pt5-25'])
  })
})

describe('sortEntries', () => {
  const setsById = { sv3pt5: { release_date: '2023-09-22' }, base1: { release_date: '1999-01-09' } }

  it('sorts by most recent first', () => {
    expect(ids(sortEntries(ENTRIES, 'recent'))[0]).toBe('sv3pt5-25')
  })

  it('sorts by rarity, then value', () => {
    expect(ids(sortEntries(ENTRIES, 'rarity')).slice(0, 3)).toEqual(['sv3pt5-199', 'base1-4', 'sv3pt5-6'])
  })

  it('sorts by set (newest first) then collector number', () => {
    expect(ids(sortEntries(ENTRIES, 'set', setsById))).toEqual(['sv3pt5-6', 'sv3pt5-25', 'sv3pt5-199', 'base1-4', 'base1-58'])
  })

  it('sorts by quantity, and does not mutate its input', () => {
    const before = ids(ENTRIES)
    expect(ids(sortEntries(ENTRIES, 'quantity')).slice(0, 2)).toEqual(['sv3pt5-25', 'base1-4'])
    expect(ids(ENTRIES)).toEqual(before)
  })
})

describe('setProgress', () => {
  it('lists started sets, most complete first', () => {
    const sets = [
      { id: 'sv3pt5', total: 207, release_date: '2023-09-22' },
      { id: 'base1', total: 102, release_date: '1999-01-09' },
      { id: 'sv4', total: 266, release_date: '2023-11-03' },
    ]
    const progress = setProgress(ENTRIES, sets)
    expect(progress.map((p) => [p.set.id, p.owned, p.total])).toEqual([
      ['base1', 2, 102],
      ['sv3pt5', 3, 207],
    ])
  })
})

describe('collectionStats', () => {
  it('sums copies and market value', () => {
    expect(collectionStats(ENTRIES)).toEqual({ uniqueCards: 5, totalCards: 8, setsStarted: 2, value: 0.6 + 120 + 4 + 600 })
  })
})

describe('binderSlots', () => {
  it('lists the whole set in number order with owned quantities', () => {
    const setCards = [{ id: 'base1-10' }, { id: 'base1-2' }, { id: 'base1-4' }]
    const entries = [{ card_id: 'base1-4', quantity: 2, cards: {} }]
    expect(binderSlots(setCards, entries).map((s) => [s.card.id, s.quantity])).toEqual([
      ['base1-2', 0],
      ['base1-4', 2],
      ['base1-10', 0],
    ])
  })
})

describe('pokedexSlots', () => {
  it('fills owned species and keeps the shortest name', () => {
    const entries = [
      { cards: { name: 'Charizard ex', national_pokedex_number: 6 } },
      { cards: { name: 'Charizard', national_pokedex_number: 6 } },
      { cards: { name: 'Pikachu', national_pokedex_number: 25 } },
      { cards: { name: 'Professor Oak', national_pokedex_number: null } },
    ]
    const slots = pokedexSlots(entries, 30)
    expect(slots).toHaveLength(30)
    expect(slots[5]).toEqual({ number: 6, owned: 2, name: 'Charizard' })
    expect(slots[24]).toMatchObject({ number: 25, owned: 1 })
    expect(slots[0]).toEqual({ number: 1, owned: 0, name: null })
  })
})

describe('filterEntries by Pokédex number', () => {
  it('keeps only that species', () => {
    const entries = [
      { card_id: 'a', quantity: 1, cards: { name: 'A', national_pokedex_number: 6 } },
      { card_id: 'b', quantity: 1, cards: { name: 'B', national_pokedex_number: 7 } },
    ]
    expect(filterEntries(entries, { dex: 6 }).map((e) => e.card_id)).toEqual(['a'])
  })
})
