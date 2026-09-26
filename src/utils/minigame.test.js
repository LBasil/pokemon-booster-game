import { describe, expect, it } from 'vitest'
import { COINS_PER_ANSWER, minRatio, nextAnswerReward, pricierSide } from './minigame'

describe('minRatio', () => {
  it('narrows the price gap as the streak grows', () => {
    expect([0, 2, 3, 5, 6, 9, 10, 40].map(minRatio)).toEqual([3, 3, 2, 2, 1.5, 1.5, 1.25, 1.25])
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

describe('pricierSide', () => {
  it('picks the higher price, left on a tie', () => {
    expect(pricierSide(12, 3)).toBe('left')
    expect(pricierSide(0.5, 2)).toBe('right')
    expect(pricierSide(4, 4)).toBe('left')
    expect(pricierSide(null, 1)).toBe('right')
  })
})
