import { describe, expect, it } from 'vitest'
import { matchSet, normalizeNumber, numberOfId, tcgdexImage } from './tcgdex'

describe('normalizeNumber', () => {
  it('drops leading zeros, keeps prefixes and suffixes', () => {
    expect(normalizeNumber('006')).toBe('6')
    expect(normalizeNumber('4')).toBe('4')
    expect(normalizeNumber('TG01')).toBe('TG1')
    expect(normalizeNumber('tg01')).toBe('TG1')
    expect(normalizeNumber('SV1')).toBe('SV1')
    expect(normalizeNumber('A')).toBe('A')
    expect(normalizeNumber('0')).toBe('0')
  })
})

describe('numberOfId', () => {
  it('keeps everything after the first dash', () => {
    expect(numberOfId('sv3pt5-6')).toBe('6')
    expect(numberOfId('swsh9tg-TG01')).toBe('TG01')
  })
})

describe('matchSet', () => {
  const ours = [
    { id: 'sv3pt5-1', name: 'Bulbasaur' },
    { id: 'sv3pt5-4', name: 'Charmander' },
    { id: 'sv3pt5-6', name: 'Charizard ex' },
  ]
  it('finds the set with the same numbers and names', () => {
    const theirs = [
      { id: 'sv03', cards: [{ localId: '001', name: 'Sprigatito' }] },
      {
        id: 'sv03.5',
        cards: [
          { localId: '001', name: 'Bulbasaur' },
          { localId: '004', name: 'Charmander' },
          { localId: '006', name: 'Charizard ex' },
        ],
      },
    ]
    expect(matchSet(ours, theirs)).toBe('sv03.5')
  })

  it('refuses a weak match', () => {
    expect(matchSet(ours, [{ id: 'miscp', cards: [{ localId: '1', name: 'Bulbasaur' }] }])).toBeNull()
    expect(matchSet([], [{ id: 'x', cards: [] }])).toBeNull()
  })
})

describe('tcgdexImage', () => {
  it('adds the quality and format', () => {
    expect(tcgdexImage('https://assets.tcgdex.net/fr/base/base1/4')).toBe('https://assets.tcgdex.net/fr/base/base1/4/low.webp')
    expect(tcgdexImage('https://assets.tcgdex.net/fr/base/base1/4', 'large')).toBe('https://assets.tcgdex.net/fr/base/base1/4/high.webp')
    expect(tcgdexImage(null)).toBeNull()
  })
})
