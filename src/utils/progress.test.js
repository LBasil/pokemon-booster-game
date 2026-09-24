import { describe, expect, it } from 'vitest'
import { completionPercent } from './progress'

describe('completionPercent', () => {
  it('is 0 for an empty collection or an empty pool', () => {
    expect(completionPercent(0, 20670)).toBe(0)
    expect(completionPercent(5, 0)).toBe(0)
  })

  it('keeps one decimal for small collections so progress stays visible', () => {
    expect(completionPercent(1, 20670)).toBe(0.1)
    expect(completionPercent(250, 20670)).toBe(1.2)
  })

  it('rounds to whole percents from 10% up', () => {
    expect(completionPercent(2500, 20670)).toBe(12)
  })

  it('only shows 100% for a truly complete collection', () => {
    expect(completionPercent(20669, 20670)).toBe(99)
    expect(completionPercent(20670, 20670)).toBe(100)
  })
})
