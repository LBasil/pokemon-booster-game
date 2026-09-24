import { describe, expect, it } from 'vitest'
import { timeAgo } from './time'

const NOW = new Date('2026-09-24T12:00:00Z')

describe('timeAgo', () => {
  it('uses the largest fitting unit', () => {
    expect(timeAgo('2026-09-24T11:57:00Z', 'en', NOW)).toBe('3 min. ago')
    expect(timeAgo('2026-09-24T09:00:00Z', 'en', NOW)).toBe('3 hr. ago')
    expect(timeAgo('2026-09-22T12:00:00Z', 'en', NOW)).toBe('2 days ago')
  })

  it('says "now" under a minute', () => {
    expect(timeAgo('2026-09-24T11:59:30Z', 'en', NOW)).toBe('now')
  })

  it('is localized', () => {
    // French uses a narrow no-break space
    expect(timeAgo('2026-09-24T11:57:00Z', 'fr', NOW).replace(/\s/g, ' ')).toBe('il y a 3 min')
  })
})
