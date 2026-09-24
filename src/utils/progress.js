/**
 * Share of the card pool a user owns, as a percentage for display.
 * Keeps one decimal below 10% so early progress doesn't read as "0%",
 * and never rounds a partial collection up to 100%.
 * @param {number} owned - unique cards owned
 * @param {number} total - unique cards in the pool
 * @returns {number} 0–100
 */
export function completionPercent(owned, total) {
  if (!total || owned <= 0) return 0
  if (owned >= total) return 100

  const percent = (owned / total) * 100
  const rounded = percent < 10 ? Math.round(percent * 10) / 10 : Math.round(percent)
  return Math.max(0.1, Math.min(99, rounded))
}
