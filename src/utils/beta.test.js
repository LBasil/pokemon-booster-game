import { describe, expect, it } from 'vitest'
import { isBetaTester } from './beta'

describe('isBetaTester', () => {
  it('counts every account while the beta runs', () => {
    expect(isBetaTester('2026-09-01T00:00:00Z', null)).toBe(true)
    expect(isBetaTester('2031-01-01T00:00:00Z', null)).toBe(true)
  })

  it('keeps only the accounts created before the end of the beta', () => {
    const end = '2027-01-01T00:00:00Z'
    expect(isBetaTester('2026-12-31T23:59:59Z', end)).toBe(true)
    expect(isBetaTester('2027-01-01T00:00:00Z', end)).toBe(false)
  })

  it('needs a valid sign-up date', () => {
    expect(isBetaTester(null, null)).toBe(false)
    expect(isBetaTester('not a date', null)).toBe(false)
  })
})
