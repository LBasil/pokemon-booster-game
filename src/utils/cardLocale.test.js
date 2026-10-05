import { describe, expect, it } from 'vitest'
import { cardImageIn, cardNameIn, cardSrcsetIn, englishImage } from './cardLocale'

const charizard = {
  name: 'Charizard',
  name_fr: 'Dracaufeu',
  image_small: 'https://images.pokemontcg.io/base1/4.png',
  image_url: 'https://images.pokemontcg.io/base1/4_hires.png',
  image_fr: 'https://assets.tcgdex.net/fr/base/base1/4',
}
const englishOnly = { name: 'Charizard', image_small: 'https://images.pokemontcg.io/base4/4.png', image_url: null }

describe('cardNameIn', () => {
  it('uses the French name when there is one and French is on', () => {
    expect(cardNameIn(charizard, true)).toBe('Dracaufeu')
    expect(cardNameIn(charizard, false)).toBe('Charizard')
    expect(cardNameIn(englishOnly, true)).toBe('Charizard')
    expect(cardNameIn(null, true)).toBe('')
  })
})

describe('cardImageIn', () => {
  it('uses the TCGdex image in French, the English one otherwise', () => {
    expect(cardImageIn(charizard, true)).toBe('https://assets.tcgdex.net/fr/base/base1/4/low.webp')
    expect(cardImageIn(charizard, true, 'large')).toBe('https://assets.tcgdex.net/fr/base/base1/4/high.webp')
    expect(cardImageIn(charizard, false)).toBe(charizard.image_small)
    expect(cardImageIn(charizard, false, 'large')).toBe(charizard.image_url)
    expect(cardImageIn(englishOnly, true, 'large')).toBe(englishOnly.image_small)
  })

  it('keeps the English image as the fallback', () => {
    expect(englishImage(charizard)).toBe(charizard.image_small)
    expect(englishImage({})).toBeNull()
  })
})

describe('cardSrcsetIn', () => {
  it('lists both sizes of the shown language', () => {
    expect(cardSrcsetIn(charizard, true)).toBe(
      'https://assets.tcgdex.net/fr/base/base1/4/low.webp 245w, https://assets.tcgdex.net/fr/base/base1/4/high.webp 600w',
    )
    expect(cardSrcsetIn(charizard, false)).toBe(`${charizard.image_small} 245w, ${charizard.image_url} 734w`)
    expect(cardSrcsetIn(englishOnly, true)).toBeNull()
  })
})
