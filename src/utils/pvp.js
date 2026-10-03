// PvP battle rules. Mirrors pvp_rules(), pvp_damage() and pvp_elo_change()
// in supabase/migrations/0024_pvp_battles.sql — change both together. The
// server stays the authority (it sends the rules with its state and plays
// every round): these only drive labels and previews.

export const DECK_SIZE = 5
export const KOS_TO_WIN = 3
export const MAX_ROUNDS = 15
export const BATTLES_PER_DAY = 10
export const START_ELO = 1000
export const K_FACTOR = 32
export const WEAKNESS_MULTIPLIER = 2
export const RESISTANCE = 30
export const MIN_DAMAGE = 10

/**
 * Damage of one card's attack on another (card snapshots from the server:
 * damage, times, types, weaknesses, resistances).
 * @param {number} [roll] - 1 to 3, multiplies a "20×" attack
 */
export function damageAgainst(from, to, roll = 1) {
  const types = from.types ?? []
  const weak = types.some((type) => (to.weaknesses ?? []).includes(type))
  const resisted = types.some((type) => (to.resistances ?? []).includes(type))
  const base = from.damage * (from.times ? roll : 1) * (weak ? WEAKNESS_MULTIPLIER : 1) - (resisted ? RESISTANCE : 0)
  return Math.max(MIN_DAMAGE, base)
}

/** Elo points `a` gains (or loses, negative) for a result against `b`: 1 win, 0.5 draw, 0 loss. */
export function eloChange(a, b, score) {
  return Math.round(K_FACTOR * (score - 1 / (1 + 10 ** ((b - a) / 400))))
}

/** Attack damage as printed: "30", or "30×" for a multiplied one. */
export const damageLabel = (card) => `${card.damage}${card.times ? '×' : ''}`

/**
 * Wins, losses, draws and win rate (%, rounded, null before any battle) of a
 * rating row, attacks and defenses together.
 */
export function record(rating) {
  const wins = (rating?.wins ?? 0) + (rating?.def_wins ?? 0)
  const losses = (rating?.losses ?? 0) + (rating?.def_losses ?? 0)
  const draws = (rating?.draws ?? 0) + (rating?.def_draws ?? 0)
  const total = wins + losses + draws
  return { wins, losses, draws, total, rate: total ? Math.round((100 * wins) / total) : null }
}

/**
 * The parts of a format key: 'all', 'era:<series>' or 'set:<set id>'.
 * @returns {{ kind: 'all' | 'era' | 'set', value: string | null }}
 */
export function parseFormat(format) {
  const [, kind, value] = /^(era|set):(.+)$/.exec(format ?? '') ?? []
  return kind ? { kind, value } : { kind: 'all', value: null }
}

/**
 * The deck after tapping a card in the builder: removes it if picked, adds it
 * while there's room.
 */
export function toggleDeckCard(deck, id, size = DECK_SIZE) {
  if (deck.includes(id)) return deck.filter((picked) => picked !== id)
  return deck.length < size ? [...deck, id] : deck
}

/** HP left as a share of the card's HP (0-100), for the bars. */
export const hpPercent = (card) => (card.hp ? Math.max(0, Math.min(100, (100 * (card.hp_left ?? card.hp)) / card.hp)) : 0)
