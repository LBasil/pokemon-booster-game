import { describe, expect, it } from 'vitest'
import { groupSetsByYear, setLogoUrl } from './sets'

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
  it('points at the pokemontcg.io CDN', () => {
    expect(setLogoUrl('base1')).toBe('https://images.pokemontcg.io/base1/logo.png')
  })
})
