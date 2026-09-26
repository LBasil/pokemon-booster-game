// "Higher or lower" mini-game rules. Mirrors minigame_rules() and
// minigame_min_ratio() in supabase/migrations/0013_minigame_higher_lower.sql
// — change both together. The server stays the authority (it also sends
// the rules with its state): these only drive labels before it answers.

export const PAID_RUNS = 3
export const COINS_PER_ANSWER = 5
export const MAX_PAID_ANSWERS = 20
export const ANSWER_SECONDS = 15

/** The smallest price ratio between the two cards at a given streak. */
export function minRatio(streak) {
  if (streak < 3) return 3
  if (streak < 6) return 2
  if (streak < 10) return 1.5
  return 1.25
}

/** Coins the next right answer pays: 5 in a paid run, for its first 20. */
export const nextAnswerReward = (run) =>
  run?.paid && run.streak < MAX_PAID_ANSWERS ? COINS_PER_ANSWER : 0

/** Which card was worth more: 'left' | 'right' (ties count for both). */
export const pricierSide = (left, right) => ((left ?? 0) >= (right ?? 0) ? 'left' : 'right')
