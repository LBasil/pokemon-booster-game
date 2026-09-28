// "Super effective!" mini-game rules. Mirrors super_effective_rules(),
// super_effective_types() and super_effective_option_count() in
// supabase/migrations/0015_minigame_super_effective.sql — change both
// together. The server stays the authority (it also sends the rules with its
// state): these only drive labels before it answers.

export const PAID_RUNS = 3
export const COINS_PER_ANSWER = 5
export const MAX_PAID_ANSWERS = 20
export const ANSWER_SECONDS = 10

/** The types a card can be weak to (Colorless never is). */
export const WEAKNESS_TYPES = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal', 'Fairy', 'Dragon']

/** How many types are offered at a given streak. */
export function optionCount(streak) {
  if (streak < 5) return 3
  if (streak < 10) return 4
  return 6
}

/** Coins the next right answer pays: 5 in a paid run, for its first 20. */
export const nextAnswerReward = (run) =>
  run?.paid && run.streak < MAX_PAID_ANSWERS ? COINS_PER_ANSWER : 0

/** Keyboard shortcut for an option: '1'..'6' → its index, else -1. */
export function optionIndexForKey(key, count) {
  const index = Number(key) - 1
  return Number.isInteger(index) && index >= 0 && index < count ? index : -1
}
