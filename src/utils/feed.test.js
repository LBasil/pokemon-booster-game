import { describe, expect, it } from 'vitest'
import { groupFeed } from './feed'

const pull = (id, username, bucket = 'holo', mode = 'unlimited') => ({ id, username, bucket, mode, pulled_at: `2026-10-02T10:${String(60 - id).padStart(2, '0')}:00Z` })

describe('groupFeed', () => {
  it('folds consecutive pulls of one player in one mode, showing the rarest', () => {
    const feed = [pull(1, 'Bazouk'), pull(2, 'Bazouk', 'secret'), pull(3, 'Bazouk', 'ultra'), pull(4, 'Misty')]
    const groups = groupFeed(feed)
    expect(groups.map((g) => [g.best.id, g.pulls.length])).toEqual([[2, 3], [4, 1]])
    expect(groups[0].key).toBe(1)
    expect(groups[0].pulls.map((p) => p.id)).toEqual([1, 2, 3])
  })

  it('keeps the latest pull among equally rare ones', () => {
    expect(groupFeed([pull(1, 'A'), pull(2, 'A')])[0].best.id).toBe(1)
  })

  it('never merges another player, another mode, or non-consecutive pulls', () => {
    const feed = [pull(1, 'A'), pull(2, 'A', 'holo', 'challenge'), pull(3, 'B'), pull(4, 'A')]
    expect(groupFeed(feed).map((g) => g.pulls.length)).toEqual([1, 1, 1, 1])
    expect(groupFeed([])).toEqual([])
  })
})
