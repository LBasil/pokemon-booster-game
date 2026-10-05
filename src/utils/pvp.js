// PvP battles like Pokémon TCG Pocket (migration 0030). Mirrors pvp_rules(),
// pvp_prizes(), pvp_deck_cards() and pvp_bot_deck() in
// supabase/migrations/0030_pvp_pocket.sql, and the bot coins of
// 0027_pvp_bots.sql — change both together. The server stays the authority:
// it plays every move and sends what I can do now (`battle.hints`); these
// drive the deck builder, labels and previews.

export const DECK_SIZE = 20
export const MAX_COPIES = 2
export const HAND_SIZE = 5
export const BENCH_SIZE = 3
export const POINTS_TO_WIN = 3
export const MAX_TURNS = 30
export const BATTLES_PER_DAY = 10
export const START_ELO = 1000
export const K_FACTOR = 32
export const WEAKNESS_MULTIPLIER = 2
export const RESISTANCE = 30
export const POISON = 10
export const BURN = 20

// Who can play while PvP is being reworked (0028, user 2026-10-05: "bloque le
// PvP uniquement pour le joueur Bazouk"): lowercased usernames, mirrors
// pvp_open_to(). Everyone else sees "Coming soon". null = open to all.
export const PVP_TESTERS = ['bazouk']

/** @param {string | null | undefined} username */
export const pvpOpenTo = (username, testers = PVP_TESTERS) =>
  testers === null || testers.includes((username ?? '').trim().toLowerCase())

// Bots (0027): no Elo, coins for the first battles of the game day
export const BOT_LEVELS = ['easy', 'normal', 'hard']
export const BOT_COINS = { easy: 10, normal: 25, hard: 50 }
export const BOT_PAID_PER_DAY = 5
export const BOT_BATTLES_PER_DAY = 20

/**
 * Coins a finished bot battle pays: the level's coins for a win, half
 * (rounded down) for a draw, nothing for a loss / giving up or an unpaid one.
 */
export function botCoins(level, status, paid = true, coins = BOT_COINS) {
  if (!paid) return 0
  const share = status === 'won' ? 1 : status === 'draw' ? 0.5 : 0
  return Math.floor((coins[level] ?? 0) * share)
}

/** Points a card gives when knocked out, from its subtypes (the real TCG's rule boxes). */
export function prizesFor(subtypes = []) {
  const has = (type) => subtypes.includes(type)
  if (['VMAX', 'TAG TEAM', 'V-UNION'].some(has) || (has('MEGA') && has('ex'))) return 3
  if (['ex', 'EX', 'GX', 'V', 'VSTAR', 'LEGEND'].some(has)) return 2
  return 1
}

/** Elo points `a` gains (or loses, negative) for a result against `b`: 1 win, 0.5 draw, 0 loss. */
export function eloChange(a, b, score) {
  return Math.round(K_FACTOR * (score - 1 / (1 + 10 ** ((b - a) / 400))))
}

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

/** The two decks of a format: 'attack' = the one I play, 'defense' = the one the server plays for me. */
export const DECK_ROLES = ['attack', 'defense']

/** A format's decks as `{ attack, defense }`, each `{ ids, valid }` or null. */
export function deckRoles(entry) {
  return { attack: entry?.attack ?? null, defense: entry?.defense ?? null }
}

// ---------- Deck builder ----------

/** How many copies of each card id a deck holds. */
export function deckCounts(ids) {
  const counts = new Map()
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
  return counts
}

/**
 * Why a card can't go in the deck now, null if it can: 'full' (20),
 * 'copies' (2 of that name already), 'owned' (every copy I own is in).
 * @param {string[]} ids - the deck
 * @param {{ id: string, name: string, owned?: number }} card
 * @param {Map<string, object>} cardsById - eligible cards, for the names in the deck
 */
export function addBlock(ids, card, cardsById, size = DECK_SIZE) {
  if (ids.length >= size) return 'full'
  if (ids.filter((id) => cardsById.get(id)?.name === card.name).length >= MAX_COPIES) return 'copies'
  if (ids.filter((id) => id === card.id).length >= (card.owned ?? MAX_COPIES)) return 'owned'
  return null
}

/** The deck with one more copy of a card (unchanged if it can't take it). */
export const addCard = (ids, card, cardsById, size = DECK_SIZE) => (addBlock(ids, card, cardsById, size) ? ids : [...ids, card.id])

/** The deck with one copy of a card less. */
export function removeCard(ids, id) {
  const i = ids.lastIndexOf(id)
  return i < 0 ? ids : [...ids.slice(0, i), ...ids.slice(i + 1)]
}

/**
 * What a deck still needs before it can be saved, and its warnings.
 * @returns {{ ready: boolean, missing: number, basics: number, orphans: string[] }}
 *   orphans: evolutions whose "evolves from" Pokémon isn't in the deck (legal, but stuck in hand)
 */
export function deckCheck(ids, cardsById, size = DECK_SIZE) {
  const cards = ids.map((id) => cardsById.get(id)).filter(Boolean)
  const names = new Set(cards.map((card) => card.name))
  const basics = cards.filter((card) => card.stage === 'basic').length
  const orphans = [...new Set(cards.filter((card) => card.stage === 'evolution' && !names.has(card.evolves_from)).map((card) => card.name))]
  return { ready: cards.length === size && basics > 0, missing: Math.max(0, size - cards.length), basics, orphans }
}

// Auto deck: each card scores damage per energy (one energy a turn), its best
// hit and its HP per point given (relative to the best here); the role
// weighs them (attack: I play it; defense: the server's AI does, so bulk).
const AUTO_WEIGHTS = {
  attack: { perEnergy: 1, burst: 0.5, bulk: 0.7 },
  defense: { perEnergy: 0.7, burst: 0.4, bulk: 1 },
}

function scoreCards(cards, role) {
  const weights = AUTO_WEIGHTS[role] ?? AUTO_WEIGHTS.attack
  const stats = cards.map((card) => {
    const usable = (card.attacks ?? []).filter((a) => a.usable !== false)
    return {
      card,
      perEnergy: Math.max(0, ...usable.map((a) => (a.base ?? 0) / Math.max(a.cost ?? 0, 1))),
      burst: Math.max(0, ...usable.map((a) => a.base ?? 0)),
      bulk: (card.hp ?? 0) / Math.max(card.prizes ?? 1, 1),
    }
  })
  const top = (key) => Math.max(1, ...stats.map((s) => s[key]))
  const max = { perEnergy: top('perEnergy'), burst: top('burst'), bulk: top('bulk') }
  return new Map(stats.map((s) => [s.card.id, Object.entries(weights).reduce((sum, [key, w]) => sum + (w * s[key]) / max[key], 0)]))
}

/**
 * A deck from my eligible cards (`pvp_eligible`: stage, evolves_from,
 * owned copies, attacks), built like the bots' (pvp_bot_deck): a Stage 2
 * line, up to two Stage 1 lines, then Basics, 2 copies of each when I own
 * them, the best scores first; the best single copies fill what's left.
 * @param {object[]} cards
 * @param {'attack' | 'defense'} [role]
 * @returns {string[]} card ids (with repeats), up to `size`
 */
export function autoDeck(cards, role = 'attack', size = DECK_SIZE) {
  const playable = cards.filter((card) => card.stage !== 'none' && (card.attacks ?? []).some((a) => a.usable !== false))
  const score = scoreCards(playable, role)
  const byId = new Map(playable.map((card) => [card.id, card]))
  // The best printing of each name, at each stage
  const best = new Map()
  for (const card of playable) {
    const kept = best.get(card.name)
    if (!kept || score.get(card.id) > score.get(kept.id)) best.set(card.name, card)
  }
  const named = [...best.values()]
  const basicNamed = (name) => named.find((card) => card.name === name && card.stage === 'basic')
  const evolutionNamed = (name) => named.find((card) => card.name === name && card.stage === 'evolution')
  const lines = []
  for (const top of named.filter((card) => card.stage === 'evolution')) {
    const stage1 = evolutionNamed(top.evolves_from)
    const basic = stage1 ? basicNamed(stage1.evolves_from) : basicNamed(top.evolves_from)
    if (stage1 && basic) lines.push([basic, stage1, top])
    else if (!stage1 && basic) lines.push([basic, top])
  }
  for (const basic of named.filter((card) => card.stage === 'basic')) lines.push([basic])
  const lineScore = (line) => line.reduce((sum, card) => sum + score.get(card.id), 0) / line.length
  lines.sort((a, b) => b.length - a.length || lineScore(b) - lineScore(a) || a[0].id.localeCompare(b[0].id))

  let ids = []
  let stage2 = 0
  let stage1 = 0
  for (const line of lines) {
    if (line.some((card) => ids.some((id) => byId.get(id).name === card.name))) continue
    if (line.length === 3 && stage2 >= 1) continue
    if (line.length === 2 && stage1 >= 2) continue
    const copies = Math.min(MAX_COPIES, ...line.map((card) => card.owned ?? MAX_COPIES))
    if (ids.length + copies * line.length > size) continue
    for (const card of line) for (let i = 0; i < copies; i++) ids = addCard(ids, card, byId, size)
    stage2 += line.length === 3
    stage1 += line.length === 2
    if (ids.length >= size) break
  }
  // Fill: the best cards left (Basics first, they can always be played)
  const rest = [...playable].sort((a, b) => (b.stage === 'basic') - (a.stage === 'basic') || score.get(b.id) - score.get(a.id))
  for (const card of rest) {
    if (ids.length >= size) break
    if (card.stage === 'evolution' && !ids.some((id) => byId.get(id).name === card.evolves_from)) continue
    while (!addBlock(ids, card, byId, size)) ids = [...ids, card.id]
  }
  return ids
}

// ---------- Battle ----------

/** HP left as a share of the card's HP (0-100), for the bars. */
export const hpPercent = (hpLeft, hp) => (hp ? Math.max(0, Math.min(100, (100 * hpLeft) / hp)) : 0)

/** An attack's damage as printed ("30", "20×", "60+"), or its base. */
export const damageLabel = (attack) => attack?.printed || (attack?.base ? String(attack.base) : '')

/** The effect text to show: French when wanted and imported. */
export const attackText = (attack, french) => (french && attack?.text_fr) || attack?.text || ''

/** The attack's name to show. */
export const attackName = (attack, french) => (french && attack?.name_fr) || attack?.name || ''

/** Whether an attack needs me to pick a target / a Benched Pokémon, and which. */
export function attackChoices(attack) {
  const ops = new Set((attack?.fx ?? []).map((op) => op.op))
  return {
    target: ops.has('snipe') ? 'any' : ops.has('bench_one') ? 'bench' : null,
    switchTo: ops.has('switch_self'),
    energyTo: ops.has('move_energy'),
  }
}
