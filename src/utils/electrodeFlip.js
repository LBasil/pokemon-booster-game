// "Shiny Electrode Flip" mini-game rules (Voltorb Flip). Mirrors
// electrode_flip_rules() and electrode_flip_end() in
// supabase/migrations/0014_minigame_electrode_flip.sql — change both
// together. The server stays the authority (it sends the rules with its
// state): these only drive labels and the level preview.

export const SIZE = 5
export const LEVELS = 5
export const DAILY_COINS = 300

/** Tile index (0..24, row by row) of a row and a column. */
export const tileIndex = (row, col) => row * SIZE + col

/** Points after flipping a tile worth `value` (0 = Electrode, the board is lost). */
export const pointsAfter = (points, value) => (value === 0 ? 0 : points === 0 ? value : points * value)

/** Coins a board worth `points` pays with `coinsLeft` still to win today. */
export const coinsFor = (points, coinsLeft) => Math.max(0, Math.min(points, coinsLeft))

/** The next board's level once this one ends ('won' | 'lost' | 'cashed'). */
export function nextLevel(level, flips, status) {
  if (status === 'won') return Math.min(level + 1, LEVELS)
  return Math.max(1, Math.min(level, flips))
}

/**
 * Lines (rows or columns) with no Electrode, or only 1s left to find: flipping
 * anything there is safe or pointless. The view dims the pointless ones.
 * @param {{ points: number, electrodes: number }} hint
 * @returns {'safe' | 'dud' | null} dud = only 1s and Electrodes (nothing to gain)
 */
export function lineKind(hint) {
  if (hint.electrodes === 0) return 'safe'
  if (hint.points + hint.electrodes === SIZE) return 'dud'
  return null
}
