import { describe, expect, it } from 'vitest'
import { COINS_PER_ANSWER, MAX_PAID_ANSWERS, PAID_RUNS, intruderCount, nextAnswerReward, togglePick } from './evolutionChain'
import * as superEffective from './superEffective'

describe('intruderCount', () => {
  it('mixes in more cards from other lines as the streak grows', () => {
    expect([0, 4, 5, 9, 10, 40].map(intruderCount)).toEqual([0, 0, 1, 1, 2, 2])
  })
})

describe('nextAnswerReward', () => {
  it('pays the first 20 right lines of a paid run', () => {
    expect(nextAnswerReward({ paid: true, streak: 0 })).toBe(COINS_PER_ANSWER)
    expect(nextAnswerReward({ paid: true, streak: 19 })).toBe(COINS_PER_ANSWER)
    expect(nextAnswerReward({ paid: true, streak: 20 })).toBe(0)
  })

  it('never pays an unpaid run, nor no run', () => {
    expect(nextAnswerReward({ paid: false, streak: 0 })).toBe(0)
    expect(nextAnswerReward(null)).toBe(0)
  })

  it('pays less a day than the other games (the simplest one)', () => {
    const daily = PAID_RUNS * COINS_PER_ANSWER * MAX_PAID_ANSWERS
    expect(daily).toBe(180)
    expect(daily).toBeLessThan(superEffective.PAID_RUNS * superEffective.COINS_PER_ANSWER * superEffective.MAX_PAID_ANSWERS)
  })
})

describe('togglePick', () => {
  it('adds cards in the order tapped, 3 at most', () => {
    let picks = togglePick([], 'a')
    picks = togglePick(picks, 'b')
    picks = togglePick(picks, 'c')
    expect(picks).toEqual(['a', 'b', 'c'])
    expect(togglePick(picks, 'd')).toEqual(['a', 'b', 'c'])
  })

  it('tapping a picked card takes it back with the picks after it', () => {
    expect(togglePick(['a', 'b'], 'b')).toEqual(['a'])
    expect(togglePick(['a', 'b'], 'a')).toEqual([])
  })
})
