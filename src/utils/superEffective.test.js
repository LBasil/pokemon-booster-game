import { describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en.json'
import fr from '@/i18n/locales/fr.json'
import { COINS_PER_ANSWER, WEAKNESS_TYPES, nextAnswerReward, optionCount, optionIndexForKey } from './superEffective'

describe('optionCount', () => {
  it('offers more types as the streak grows', () => {
    expect([0, 4, 5, 9, 10, 40].map(optionCount)).toEqual([3, 3, 4, 4, 6, 6])
  })
})

describe('nextAnswerReward', () => {
  it('pays the first 20 right answers of a paid run', () => {
    expect(nextAnswerReward({ paid: true, streak: 0 })).toBe(COINS_PER_ANSWER)
    expect(nextAnswerReward({ paid: true, streak: 19 })).toBe(COINS_PER_ANSWER)
    expect(nextAnswerReward({ paid: true, streak: 20 })).toBe(0)
  })

  it('never pays an unpaid run, nor no run', () => {
    expect(nextAnswerReward({ paid: false, streak: 0 })).toBe(0)
    expect(nextAnswerReward(null)).toBe(0)
  })
})

describe('optionIndexForKey', () => {
  it('maps the number keys to the options on screen', () => {
    expect(optionIndexForKey('1', 3)).toBe(0)
    expect(optionIndexForKey('3', 3)).toBe(2)
    expect(optionIndexForKey('4', 3)).toBe(-1)
    expect(optionIndexForKey('0', 3)).toBe(-1)
    expect(optionIndexForKey('a', 3)).toBe(-1)
    expect(optionIndexForKey('Enter', 6)).toBe(-1)
  })
})

describe('WEAKNESS_TYPES', () => {
  it('has a name for every type in both languages, and no Colorless', () => {
    expect(WEAKNESS_TYPES).not.toContain('Colorless')
    for (const locale of [en, fr]) {
      for (const type of WEAKNESS_TYPES) expect(locale.collection.types[type], type).toBeTruthy()
    }
  })
})
