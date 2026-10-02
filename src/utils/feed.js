// The community feed, grouped: one busy player opening pack after pack
// filled the whole feed (user, 2026-10-02: ~30 holos of one player in a
// row). Consecutive pulls of the same player in the same mode become one
// entry, showing the rarest (then latest) pull, with the others behind it.

const RANK = { holo: 1, ultra: 2, secret: 3 }

/**
 * @param {{ id: number, username: string, mode: string, bucket: string, pulled_at: string }[]} pulls newest first
 * @returns {{ key: number, best: object, pulls: object[] }[]} newest first; `pulls` keeps the feed order
 */
export function groupFeed(pulls) {
  const groups = []
  for (const pull of pulls) {
    const last = groups.at(-1)
    if (last && last.best.username === pull.username && last.best.mode === pull.mode) {
      last.pulls.push(pull)
      if ((RANK[pull.bucket] ?? 0) > (RANK[last.best.bucket] ?? 0)) last.best = pull
    } else {
      groups.push({ key: pull.id, best: pull, pulls: [pull] })
    }
  }
  return groups
}
