// "Evolution chain" mini-game rules. Mirrors evolution_chain_rules() and
// evolution_chain_intruders() in
// supabase/migrations/0018_minigame_evolution_chain.sql — change both
// together. The server stays the authority (it also sends the rules with its
// state): these only drive labels before it answers.

export const PAID_RUNS = 3
export const COINS_PER_ANSWER = 3
export const MAX_PAID_ANSWERS = 20
export const ANSWER_SECONDS = 15
/** Cards to put in order: Basic, Stage 1, Stage 2. */
export const CHAIN_LENGTH = 3

/** How many cards from another line are mixed in at a given streak. */
export function intruderCount(streak) {
  if (streak < 5) return 0
  if (streak < 10) return 1
  return 2
}

/** Coins the next right line pays: 3 in a paid run, for its first 20. */
export const nextAnswerReward = (run) =>
  run?.paid && run.streak < MAX_PAID_ANSWERS ? COINS_PER_ANSWER : 0

/**
 * The picks after tapping a card: adds it at the end, or, if it's already
 * picked, takes it back along with every pick made after it.
 * @param {string[]} picks - card ids, in the order tapped
 * @param {string} id
 */
export function togglePick(picks, id) {
  const index = picks.indexOf(id)
  if (index >= 0) return picks.slice(0, index)
  return picks.length < CHAIN_LENGTH ? [...picks, id] : picks
}
