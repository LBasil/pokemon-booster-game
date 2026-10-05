// PvP battles like Pokémon TCG Pocket (migration 0030). Mirrors pvp_rules(),
// pvp_prizes(), pvp_deck_cards() and pvp_bot_deck() in
// supabase/migrations/0030_pvp_pocket.sql, the typed energy of
// 0031_pvp_typed_energy.sql (pvp_missing(), pvp_deck_energy(),
// pvp_fits_energy()) and the bot coins of 0027_pvp_bots.sql — change both
// together. The server stays the authority:
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

// Typed energy (0031): a deck picks 1 or 2 of the types with a basic Energy
// card; each turn its zone brings one of them at random
export const ENERGY_TYPES = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal', 'Fairy']
export const MAX_ENERGY_TYPES = 2
export const ENGINE = 3

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

// ---------- Energy ----------

/**
 * Energies still missing to pay an attack (pvp_missing): each typed symbol
 * needs its type, Colorless takes whatever is left. An attack without
 * `energy` (a card synced before 0031) costs `cost` Colorless.
 * @param {string[]} have - a slot's energies (`etypes`)
 * @param {{ cost?: number, energy?: string[] }} attack
 */
export function energyMissing(have = [], attack = {}) {
  const symbols = attack.energy ?? []
  const need = new Map()
  for (const type of symbols) if (type !== 'Colorless') need.set(type, (need.get(type) ?? 0) + 1)
  let missing = 0
  let used = 0
  let typed = 0
  for (const [type, n] of need) {
    const owned = have.filter((e) => e === type).length
    missing += Math.max(n - owned, 0)
    used += Math.min(n, owned)
    typed += n
  }
  const total = Math.max(attack.cost ?? 0, symbols.length, typed)
  return missing + Math.max(total - typed - (have.length - used), 0)
}

/** Whether a card can pay one of its usable attacks with these energy types (pvp_fits_energy). */
export const fitsEnergy = (card, energy = []) =>
  (card?.attacks ?? []).some((a) => a.usable !== false && (a.energy ?? []).every((type) => type === 'Colorless' || energy.includes(type)))

/** Whether a pick of energy types is valid: 1 or 2 different known types. */
export const validEnergy = (energy) =>
  Array.isArray(energy) && energy.length >= 1 && energy.length <= MAX_ENERGY_TYPES && new Set(energy).size === energy.length && energy.every((t) => ENERGY_TYPES.includes(t))

/**
 * The energy a deck asks for (pvp_deck_energy): the types its usable
 * attacks need most, a second one if it's needed at least a quarter as
 * much; else its Pokémon's most common type; else Grass.
 * @param {object[]} cards - the deck's cards (one per copy)
 */
export function deckEnergy(cards) {
  const count = (types) => {
    const counts = new Map()
    for (const type of types) if (ENERGY_TYPES.includes(type)) counts.set(type, (counts.get(type) ?? 0) + 1)
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }
  const symbols = count(cards.flatMap((card) => (card.attacks ?? []).filter((a) => a.usable !== false).flatMap((a) => a.energy ?? [])))
  if (symbols.length) return symbols.filter(([, n], i) => i === 0 || (i === 1 && n * 4 >= symbols[0][1])).map(([type]) => type)
  const own = count(cards.flatMap((card) => card.types ?? []))
  return own.length ? [own[0][0]] : ['Grass']
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
 * 'copies' (2 of that name already), 'owned' (every copy I own is in),
 * 'ace_spec' (a deck holds 1 ACE SPEC Trainer, 0032).
 * @param {string[]} ids - the deck
 * @param {{ id: string, name: string, owned?: number }} card
 * @param {Map<string, object>} cardsById - eligible cards, for the names in the deck
 */
export function addBlock(ids, card, cardsById, size = DECK_SIZE) {
  if (ids.length >= size) return 'full'
  if (ids.filter((id) => cardsById.get(id)?.name === card.name).length >= MAX_COPIES) return 'copies'
  if (ids.filter((id) => id === card.id).length >= (card.owned ?? MAX_COPIES)) return 'owned'
  if (card.ace_spec && ids.some((id) => cardsById.get(id)?.ace_spec)) return 'ace_spec'
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
 * @param {string[] | null} [energy] - its energy types (null: not checked)
 * @returns {{ ready: boolean, missing: number, basics: number, orphans: string[], unpaid: string[] }}
 *   orphans: evolutions whose "evolves from" Pokémon isn't in the deck (legal, but stuck in hand)
 *   unpaid: cards whose attacks the deck's energy can't pay (legal, but they'll never attack)
 */
export function deckCheck(ids, cardsById, size = DECK_SIZE, energy = null) {
  const cards = ids.map((id) => cardsById.get(id)).filter(Boolean)
  const names = new Set(cards.map((card) => card.name))
  const basics = cards.filter((card) => card.stage === 'basic').length
  const orphans = [...new Set(cards.filter((card) => card.stage === 'evolution' && !names.has(card.evolves_from)).map((card) => card.name))]
  const unpaid = energy ? [...new Set(cards.filter((card) => card.stage !== 'trainer' && !fitsEnergy(card, energy)).map((card) => card.name))] : []
  const energyOk = energy === null || validEnergy(energy)
  return { ready: cards.length === size && basics > 0 && energyOk, missing: Math.max(0, size - cards.length), basics, orphans, unpaid }
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
 * The energy that suits my cards best: for each type, and each pair of
 * types (a bit less: the zone then brings the one I need half the time),
 * the scores of the best 20 cards it can pay; the highest wins.
 * @param {object[]} cards - eligible cards
 * @param {'attack' | 'defense'} [role]
 * @returns {string[]} 1 or 2 types
 */
export function autoEnergy(cards, role = 'attack', size = DECK_SIZE) {
  const playable = cards.filter((card) => card.stage !== 'none' && (card.attacks ?? []).some((a) => a.usable !== false))
  const score = scoreCards(playable, role)
  const value = (energy) => {
    const best = new Map() // the best printing of each name it pays
    for (const card of playable) {
      if (!fitsEnergy(card, energy)) continue
      if (!best.has(card.name) || score.get(card.id) > best.get(card.name)) best.set(card.name, score.get(card.id))
    }
    // 2 copies of each name at most
    return [...best.values()].sort((a, b) => b - a).slice(0, Math.ceil(size / MAX_COPIES)).reduce((sum, s) => sum + s, 0)
  }
  let pick = [ENERGY_TYPES[0]]
  let top = -1
  for (const [i, first] of ENERGY_TYPES.entries()) {
    const single = value([first])
    if (single > top) [pick, top] = [[first], single]
    for (const second of ENERGY_TYPES.slice(i + 1)) {
      const pair = value([first, second]) * 0.85
      if (pair > top) [pick, top] = [[first, second], pair]
    }
  }
  return pick
}

/**
 * A deck from my eligible cards (`pvp_eligible`: stage, evolves_from,
 * owned copies, attacks), built like the bots' (pvp_bot_deck): a Stage 2
 * line, up to two Stage 1 lines, then Basics, 2 copies of each when I own
 * them, the best scores first; the best single copies fill what's left.
 * With `energy`, only cards it can pay (others only if they're too few).
 * Since 0032 it keeps room for its Trainers (AUTO_TRAINERS) first.
 * @param {object[]} cards
 * @param {'attack' | 'defense'} [role]
 * @param {string[] | null} [energy]
 * @returns {string[]} card ids (with repeats), up to `size`
 */
export function autoDeck(cards, role = 'attack', size = DECK_SIZE, energy = null) {
  const trainers = autoTrainers(cards, role)
  const pokemon = autoPokemon(cards, role, size - trainers.length, energy)
  const ids = [...pokemon, ...trainers.slice(0, size - pokemon.length)]
  // Rare Candy without a Stage 2 is dead weight: again without it
  const byId = new Map(cards.map((card) => [card.id, card]))
  const candy = ids.some((id) => byId.get(id)?.fx?.some((op) => op.op === 'rare_candy'))
  if (candy && !ids.some((id) => byId.get(id)?.base_name)) {
    return autoDeck(cards.filter((card) => !card.fx?.some((op) => op.op === 'rare_candy')), role, size, energy)
  }
  return ids
}

// Trainers in an auto deck (0032): 6 to attack, 4 to defend (the server's
// AI plays it), the most useful first, 2 of each (1 ACE SPEC). Mirrors the
// scores of pvp_bot_deck().
export const AUTO_TRAINERS = { attack: 6, defense: 4 }
const TRAINER_SCORES = {
  search: 3, draw: 3, discard_hand_draw: 3, shuffle_hand_draw: 3, draw_until: 3, gust: 3, rare_candy: 4,
  heal: 2, switch_self: 2, boost: 2, tool_hp: 2, tool_reduce: 2, tool_boost: 2, tool_retaliate: 2,
}

/** How much an auto deck wants a Trainer (0 = never: it ends my turn or costs cards). */
export function trainerScore(card) {
  const ops = (card.fx ?? []).map((op) => op.op)
  if (ops.includes('end_turn') || ops.includes('discard_cost')) return 0
  return Math.max(0, ...ops.map((op) => TRAINER_SCORES[op] ?? 1))
}

function autoTrainers(cards, role) {
  const budget = AUTO_TRAINERS[role] ?? AUTO_TRAINERS.attack
  const best = new Map() // one printing per name
  for (const card of cards) {
    if (card.stage !== 'trainer' || !trainerScore(card)) continue
    if (!best.has(card.name) || (card.owned ?? 2) > (best.get(card.name).owned ?? 2)) best.set(card.name, card)
  }
  const ranked = [...best.values()].sort((a, b) => trainerScore(b) - trainerScore(a) || a.name.localeCompare(b.name))
  const byId = new Map(ranked.map((card) => [card.id, card]))
  let ids = []
  for (const card of ranked) {
    for (let i = 0; i < MAX_COPIES && ids.length < budget; i++) ids = addCard(ids, card, byId, budget)
    if (ids.length >= budget) break
  }
  return ids
}

function autoPokemon(cards, role, size, energy) {
  const all = cards.filter((card) => card.stage !== 'none' && card.stage !== 'trainer' && (card.attacks ?? []).some((a) => a.usable !== false))
  const fits = (card) => !energy || fitsEnergy(card, energy)
  const playable = all.filter(fits)
  const score = scoreCards(all, role)
  const byIdAll = new Map(all.map((card) => [card.id, card]))
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
  // Fill: the best cards left (the ones the energy pays, Basics first: they can always be played)
  const rest = [...all].sort(
    (a, b) => fits(b) - fits(a) || (b.stage === 'basic') - (a.stage === 'basic') || score.get(b.id) - score.get(a.id),
  )
  for (const card of rest) {
    if (ids.length >= size) break
    if (card.stage === 'evolution' && !ids.some((id) => byIdAll.get(id).name === card.evolves_from)) continue
    while (!addBlock(ids, card, byIdAll, size)) ids = [...ids, card.id]
  }
  return ids
}

// ---------- Battle ----------

/**
 * Whether a card snapshot matches a Trainer's search filter (mirrors
 * pvp_matches(): what, type, max_hp, no_rule_box).
 */
export function matchesFilter(card, op) {
  if (!card) return false
  const stageOk = {
    card: true,
    basic: card.stage === 'basic',
    evolution: card.stage === 'evolution',
    pokemon: card.stage === 'basic' || card.stage === 'evolution',
    trainer: card.stage === 'trainer',
  }[op.what ?? 'card'] ?? (card.stage === 'trainer' && card.kind === op.what)
  return (
    stageOk &&
    (!op.type || (card.types ?? []).includes(op.type)) &&
    (op.max_hp == null || (card.stage !== 'trainer' && card.hp <= op.max_hp)) &&
    (!op.no_rule_box || (card.stage !== 'trainer' && card.prizes === 1))
  )
}

/**
 * The choices playing a Trainer asks of me, in order (each one a param of
 * the 'trainer' move): 'discard' (a cost, cards of my hand), 'tool' / 'heal' /
 * 'candy' / 'scoop' / 'move_from' (pos: one of my Pokémon), 'evolve' (the
 * Stage 2 for Rare Candy), 'switch' / 'move_to' / 'scoop_to' (to: one of
 * my Pokémon), 'gust' / 'energy' (target: one of theirs), 'pick' (cards of
 * my deck or discard pile). The view skips the ones with nothing to choose.
 */
export function trainerSteps(card) {
  if (card?.kind === 'tool') return ['tool']
  const steps = []
  const ops = card?.fx ?? []
  const add = (...keys) => keys.forEach((key) => steps.includes(key) || steps.push(key))
  for (const op of ops) {
    if (op.op === 'discard_cost') add('discard')
    else if (op.op === 'heal' && op.who === 'one') add('heal')
    else if (op.op === 'rare_candy') add('candy', 'evolve')
    else if (op.op === 'scoop') add('scoop', 'scoop_to')
    else if (op.op === 'move_energy_own') add('move_from', 'move_to')
    else if (op.op === 'switch_self') add('switch')
    else if (op.op === 'gust') add('gust')
    else if (op.op === 'discard_opp_energy' && op.who === 'one') add('energy')
    else if (op.op === 'search' || op.op === 'recover') add('pick')
  }
  // the cost first
  return steps.sort((a, b) => (b === 'discard') - (a === 'discard'))
}

/** The move's param each choice fills. */
export const STEP_PARAM = {
  discard: 'discard', tool: 'pos', heal: 'pos', candy: 'pos', scoop: 'pos', move_from: 'pos', evolve: 'evolve',
  switch: 'to', move_to: 'to', scoop_to: 'to', gust: 'target', energy: 'target', pick: 'pick',
}

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
