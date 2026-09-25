import { describe, expect, it } from 'vitest'
import { boosterSets, groupSetsByYear, packSetId, setLogoUrl, subsetKind, subsetsOf } from './sets'

const SETS = [
  { id: 'base1', name: 'Base', release_date: '1999-01-09' },
  { id: 'sv3pt5', name: '151', release_date: '2023-09-22' },
  { id: 'sv4', name: 'Paradox Rift', release_date: '2023-11-03' },
  { id: 'pop1', name: 'POP Series 1', release_date: null },
]

describe('groupSetsByYear', () => {
  it('groups by year, newest year and newest set first, undated last', () => {
    expect(groupSetsByYear(SETS)).toEqual([
      { year: '2023', sets: [SETS[2], SETS[1]] },
      { year: '1999', sets: [SETS[0]] },
      { year: null, sets: [SETS[3]] },
    ])
  })

  it('filters by name or id, ignoring case and accents', () => {
    const sets = [...SETS, { id: 'xy1', name: 'Pokémon XY', release_date: '2014-02-05' }]
    expect(groupSetsByYear(sets, 'POKEMON')).toEqual([{ year: '2014', sets: [sets[4]] }])
    expect(groupSetsByYear(sets, 'sv3')).toEqual([{ year: '2023', sets: [SETS[1]] }])
  })

  it('returns no groups when nothing matches', () => {
    expect(groupSetsByYear(SETS, 'zzz')).toEqual([])
  })
})

describe('setLogoUrl', () => {
  it('uses the URL stored from the API (new sets live on another host)', () => {
    const set = { id: 'me3', logo_url: 'https://images.scrydex.com/pokemon/me3-logo/logo' }
    expect(setLogoUrl(set)).toBe('https://images.scrydex.com/pokemon/me3-logo/logo')
  })

  it('falls back to the historical CDN pattern for rows without one', () => {
    expect(setLogoUrl({ id: 'base1', logo_url: null })).toBe('https://images.pokemontcg.io/base1/logo.png')
  })
})

describe('subsets', () => {
  const sets = [
    { id: 'swsh9', name: 'Brilliant Stars' },
    { id: 'swsh9tg', name: 'Brilliant Stars Trainer Gallery', parent_set_id: 'swsh9' },
    { id: 'sma', name: 'Shiny Vault', parent_set_id: 'sm115' },
    { id: 'cel25c', name: 'Classic Collection', parent_set_id: 'cel25' },
    { id: 'cel25', name: 'Celebrations' },
  ]
  const byId = Object.fromEntries(sets.map((set) => [set.id, set]))

  it('hides subsets from the booster list', () => {
    expect(boosterSets(sets).map((set) => set.id)).toEqual(['swsh9', 'cel25'])
  })

  it('opens a subset through its parent', () => {
    expect(packSetId('swsh9tg', byId)).toBe('swsh9')
    expect(packSetId('swsh9', byId)).toBe('swsh9')
    expect(packSetId('unknown', byId)).toBe('unknown')
  })

  it("lists a set's subsets and names their kind", () => {
    expect(subsetsOf('swsh9', sets).map((set) => set.id)).toEqual(['swsh9tg'])
    expect(sets.map(subsetKind)).toEqual([null, 'gallery', 'vault', 'classic', null])
  })
})
