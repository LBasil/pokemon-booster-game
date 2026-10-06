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

// ---------- Auto deck ----------
//
// Built like a Pokémon TCG Pocket deck (user, 2026-10-05: "s'inspirer de
// pocket"): one energy type, a core of the strongest lines with every copy I
// own (2-2-2 Stage 2, 2-2 Stage 1, 2 Basics), then the best support, then the
// Trainers. Tuned by simulation (a scratch PGlite script with the real cards,
// the hard AI on both sides): against the same opponents it wins ~11 points
// more often than the 0026 builder, which always took a Stage 2 line first
// (Squirtle -> Blastoise over Pikachu ex) and spread single copies of 14
// names.

// What waiting costs: index = energies to attach before the attack
const AUTO_SPEED = [1, 1, 0.95, 0.9, 0.85, 0.8, 0.7, 0.6]
export const AUTO = {
  bulk: { attack: 0.9, defense: 1.26 }, // defense: the server's AI plays it, it must last
  ko: 0.3, // a hit that knocks out counts whole, plus this
  chip: 0.8, // a hit that doesn't: its share of the HP, times this
  ability: 0.08, // a playable ability (0033)
  retreat: 0.03, // per energy of retreat cost past 1
  lowerStages: 0.1, // a line's lower stages still fight a little
  single: 0.85, // per stage of a line I own a single copy of
  decay: 0.6, // energy pick: each core line weighs this much less than the one before
  twoTypes: 3, // with 2 types, each typed symbol takes ~2 x this turns (half the zones bring it)
  depth: 10, // energy pick: Pokémon it must pay to fill a deck (fewer: its score shrinks)
  lines: 4, // core lines before the Trainers fill the room (a Pocket deck runs 4-5 Pokémon)
}

/**
 * The damage an attack does per use on average, what its effects are worth
 * on top, and what using it again costs (`reuse` < 1 when it discards its
 * energy or can't attack next turn). Same reading as pvp_ai_attack_value(),
 * without a board.
 */
export function attackPower(attack) {
  const coins = typeof attack.coins === 'number' ? attack.coins : attack.coins === 'until' ? 1 : 0
  const cost = attack.cost ?? 1
  let damage = attack.base ?? 0
  let bonus = 0
  let reuse = 1
  for (const op of attack.fx ?? []) {
    const n = typeof op.n === 'number' ? op.n : 0
    const odds = op.if ? 0.5 : 1
    if (op.op === 'times' || op.op === 'plus_heads') damage += (n * coins) / 2
    else if (op.op === 'plus') damage += n * odds * 0.7
    else if (op.op === 'nothing') damage /= 2
    else if (op.op === 'per_energy_self') damage += n * cost
    else if (['if_damaged_self', 'if_damaged_opp', 'if_status_opp'].includes(op.op)) damage += n * 0.4
    else if (['per_counter_opp', 'per_bench_opp', 'per_bench_self'].includes(op.op)) damage += n * 1.5
    else if (op.op === 'status') bonus += op.target === 'self' ? -10 : (op.status === 'paralyzed' || op.status === 'asleep' ? 25 : 12) * odds
    else if (op.op === 'lock_opp') bonus += 25 * odds
    else if (op.op === 'heal_self' || op.op === 'drain') bonus += Math.min(n || damage, 60) * 0.3
    else if (op.op === 'self_damage') bonus -= n / 2
    else if (op.op === 'discard_self') reuse = Math.min(reuse, cost / (cost + (op.n === 'all' ? cost : n)))
    else if (op.op === 'lock_self') reuse = Math.min(reuse, 0.5)
    else if (op.op === 'bench_one' || op.op === 'snipe') bonus += n * 0.6
    else if (op.op === 'bench_each' || op.op === 'spread') bonus += n * 1.2
    else if (op.op === 'draw' || op.op === 'call_basic') bonus += 5 * Math.max(n, 1)
    else if (op.op === 'once') reuse = Math.min(reuse, 0.4)
  }
  return { damage: Math.max(damage, 0), bonus, reuse }
}

/** Energies to attach before an attack with a deck's energy types (a 2-type zone brings each one half the time). */
export function attackTurns(attack, energy) {
  const symbols = attack.energy?.length ? attack.energy : Array(attack.cost ?? 0).fill('Colorless')
  const cost = Math.max(attack.cost ?? 0, symbols.length)
  if (energy.length < 2) return cost
  const typed = new Map()
  for (const type of symbols) if (type !== 'Colorless') typed.set(type, (typed.get(type) ?? 0) + 1)
  return Math.max(cost, ...[...typed.values()].map((n) => 2 * n * AUTO.twoTypes))
}

const fights = (card) => (card.stage === 'basic' || card.stage === 'evolution') && (card.attacks ?? []).some((a) => a.usable !== false)

/** Values as [value, share] pairs, one per distinct value (HP go by tens: a few dozen at most). */
function shares(values) {
  const counts = new Map()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts].map(([value, n]) => [value, n / values.length])
}

/**
 * What cards are measured against: the HP of the Pokémon here (bots and
 * players come from the same eras) and their usual hit (best attack of 3
 * energies at most), as [value, share] pairs.
 */
export function autoReference(cards) {
  const foes = cards.filter(fights)
  const hits = foes
    .map((card) => Math.max(0, ...(card.attacks ?? []).filter((a) => a.usable !== false && (a.cost ?? 0) <= 3).map((a) => attackPower(a).damage)))
    .filter((hit) => hit > 0)
  return { hp: shares(foes.length ? foes.map((card) => card.hp ?? 60) : [60]), hits: shares(hits.length ? hits : [50]) }
}

/**
 * A Pokémon's worth with these energy types, against the reference: its
 * best attack's share of a foe's HP per hit (a knock out counts whole),
 * slowed by the energies it needs; plus how many usual hits it takes (4 at
 * most); plus a playable ability, minus a heavy retreat. 0 when it can't
 * attack with them.
 */
export function cardValue(card, energy, role = 'attack', ref = autoReference([card])) {
  let offense = 0
  for (const attack of card.attacks ?? []) {
    if (attack.usable === false || !fitsEnergy({ attacks: [attack] }, energy)) continue
    const { damage, bonus, reuse } = attackPower(attack)
    const hit = damage * (0.5 + 0.5 * reuse) + bonus
    if (hit <= 0) continue
    const share = ref.hp.reduce((sum, [hp, w]) => sum + w * (hit >= hp ? 1 + AUTO.ko : (AUTO.chip * hit) / hp), 0)
    offense = Math.max(offense, share * AUTO_SPEED[Math.min(attackTurns(attack, energy), AUTO_SPEED.length - 1)])
  }
  if (!offense) return 0
  const lasts = ref.hits.reduce((sum, [hit, w]) => sum + w * Math.min(Math.ceil((card.hp ?? 0) / hit), 4), 0) / 4
  const ability = (card.abilities ?? []).some((a) => a.playable && a.kind !== 'on_evolve') ? AUTO.ability : 0
  return offense + (AUTO.bulk[role] ?? AUTO.bulk.attack) * lasts + ability - AUTO.retreat * Math.max((card.retreat ?? 1) - 1, 0)
}

/**
 * The Pokémon of an auto deck with these energy types: every line I can
 * build (Basic, Basic -> Stage 1, Basic -> Stage 1 -> Stage 2) valued by its
 * top card (+ a little for its lower stages, less when I own a single
 * copy), the strongest first with every copy at once (2 at most; two
 * printings of a name can make them), 1 Stage 2 line and 2 Stage 1 lines at
 * most, `lines` lines at most, on top of the `start` ids. Returns the ids
 * and a score: the lines taken, each weighing less than the one before (the
 * core decides the energy), shrunk when they can't fill a deck.
 */
function autoPokemon(cards, role, size, energy, ref, { lines: maxLines = Infinity, start = [] } = {}) {
  const pool = cards.filter(fights)
  const value = new Map(pool.map((card) => [card.id, cardValue(card, energy, role, ref)]))
  const printings = new Map() // name -> its printings, best first
  for (const card of pool) printings.set(card.name, [...(printings.get(card.name) ?? []), card])
  for (const list of printings.values()) list.sort((a, b) => value.get(b.id) - value.get(a.id) || a.id.localeCompare(b.id))
  const owned = (name) => printings.get(name).reduce((sum, card) => sum + (card.owned ?? MAX_COPIES), 0)

  const lines = []
  for (const [name, [top]] of printings) {
    const line = [top]
    for (let card = top; card.stage === 'evolution' && line.length < 3; ) {
      card = printings.get(card.evolves_from)?.[0]
      if (!card) break
      line.unshift(card)
    }
    if (line[0].stage !== 'basic' || value.get(top.id) <= 0) continue
    const copies = Math.min(MAX_COPIES, ...line.map((card) => owned(card.name)))
    const reach = copies < MAX_COPIES ? AUTO.single ** (line.length - 1) : 1
    const lower = line.slice(0, -1).reduce((sum, card) => sum + value.get(card.id) * AUTO.lowerStages, 0)
    lines.push({ name, line, copies, worth: value.get(top.id) * reach + lower })
  }
  lines.sort((a, b) => b.worth - a.worth || a.name.localeCompare(b.name))

  const byId = new Map(pool.map((card) => [card.id, card]))
  const count = (ids, name) => ids.filter((id) => byId.get(id).name === name).length
  const taken = { 2: 0, 3: 0 }
  let ids = [...start]
  let score = 0
  let rank = 0
  for (const { line, copies: most, worth } of lines) {
    if (ids.length >= size || rank >= maxLines) break
    // a stage above its Basic already in: another line holds it
    if (line.slice(1).some((card) => count(ids, card.name) > 0)) continue
    if (line.length > 1 && taken[line.length] >= (line.length === 3 ? 1 : 2)) continue
    const need = (copies) => line.reduce((sum, card) => sum + Math.max(copies - count(ids, card.name), 0), 0)
    let copies = most
    while (copies > 0 && ids.length + need(copies) > size) copies--
    if (!copies) continue
    for (const card of line) {
      while (count(ids, card.name) < copies) {
        const printing = printings.get(card.name).find((p) => !addBlock(ids, p, byId, size))
        if (!printing) break
        ids = [...ids, printing.id]
      }
    }
    if (line.length > 1) taken[line.length]++
    score += worth * (copies < MAX_COPIES ? AUTO.single : 1) * AUTO.decay ** rank++
  }
  return { ids, score: score * Math.min(1, ids.length / Math.min(size, AUTO.depth)) }
}

/**
 * The energy that suits my cards best: each type and each pair of types
 * (their typed attacks take longer, attackTurns), scored by the core of
 * the auto deck it would get; the highest wins.
 * @param {object[]} cards - eligible cards
 * @param {'attack' | 'defense'} [role]
 * @returns {string[]} 1 or 2 types
 */
export function autoEnergy(cards, role = 'attack', size = DECK_SIZE) {
  const ref = autoReference(cards)
  const room = size - (AUTO_TRAINERS[role] ?? AUTO_TRAINERS.attack)
  const lines = AUTO.lines
  let pick = [ENERGY_TYPES[0]]
  let top = -1
  for (const [i, first] of ENERGY_TYPES.entries()) {
    for (const energy of [[first], ...ENERGY_TYPES.slice(i + 1).map((second) => [first, second])]) {
      const { score } = autoPokemon(cards, role, room, energy, ref, { lines })
      if (score > top) [pick, top] = [energy, score]
    }
  }
  return pick
}

/**
 * A deck from my eligible cards (`pvp_eligible`: stage, evolves_from,
 * owned copies, attacks), like Pocket's 4-5 Pokémon and lots of support
 * (user, 2026-10-06: the 0032 builder filled the room with single Basics,
 * 13 names in a deck): the core of autoPokemon() for that energy
 * (autoEnergy() when none is given, AUTO.lines lines), Trainers up to
 * AUTO_TRAINERS_MAX, then more lines, then the best Basics and Trainers
 * left while there's room.
 * @param {object[]} cards
 * @param {'attack' | 'defense'} [role]
 * @param {string[] | null} [energy]
 * @returns {string[]} card ids (with repeats), up to `size`
 */
export function autoDeck(cards, role = 'attack', size = DECK_SIZE, energy = null) {
  const types = energy?.length ? energy : autoEnergy(cards, role, size)
  const ref = autoReference(cards)
  const { ids: core } = autoPokemon(cards, role, size - autoTrainers(cards, role).length, types, ref, { lines: AUTO.lines })
  const most = AUTO_TRAINERS_MAX[role] ?? AUTO_TRAINERS_MAX.attack
  const trainers = autoTrainers(cards, role, Math.min(most, size - core.length))
  const { ids: pokemon } = autoPokemon(cards, role, size - trainers.length, types, ref, { start: core })
  let ids = [...pokemon, ...trainers]
  const byId = new Map(cards.map((card) => [card.id, card]))
  // Room left (few lines, few Trainers): the best Basics, then any useful Trainer
  const rest = cards
    .filter((card) => card.stage === 'basic' || (card.stage === 'trainer' && trainerScore(card)))
    .map((card) => [card, card.stage === 'basic' ? cardValue(card, types, role, ref) : -1])
    .sort((a, b) => b[1] - a[1] || a[0].id.localeCompare(b[0].id))
  for (const [card] of rest) {
    while (ids.length < size && !addBlock(ids, card, byId, size)) ids = [...ids, card.id]
  }
  // Rare Candy without a Stage 2 is dead weight: again without it
  const candy = ids.some((id) => byId.get(id)?.fx?.some((op) => op.op === 'rare_candy'))
  if (candy && !ids.some((id) => byId.get(id)?.base_name)) {
    return autoDeck(cards.filter((card) => !card.fx?.some((op) => op.op === 'rare_candy')), role, size, types)
  }
  return ids
}

// Trainers in an auto deck (0032): 6 to attack, 4 to defend (the server's
// AI plays it) next to the core lines, up to 10 / 8 before another line
// comes in, the most useful first, 2 of each (1 ACE SPEC). Mirrors the
// scores of pvp_bot_deck().
export const AUTO_TRAINERS = { attack: 6, defense: 4 }
export const AUTO_TRAINERS_MAX = { attack: 10, defense: 8 }
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

function autoTrainers(cards, role, budget = AUTO_TRAINERS[role] ?? AUTO_TRAINERS.attack) {
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
 * my Pokémon), 'gust' / 'energy' / 'counter' (target: one of theirs), 'pick'
 * (cards of my deck or discard pile). The view skips the ones with nothing
 * to choose. Abilities (0033) ask the same: pass `{ fx }`.
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
    else if (op.op === 'counters' && op.who === 'one') add('counter')
    else if (op.op === 'search' || op.op === 'recover') add('pick')
  }
  // the cost first
  return steps.sort((a, b) => (b === 'discard') - (a === 'discard'))
}

/** The move's param each choice fills. */
export const STEP_PARAM = {
  discard: 'discard', tool: 'pos', heal: 'pos', candy: 'pos', scoop: 'pos', move_from: 'pos', evolve: 'evolve',
  switch: 'to', move_to: 'to', scoop_to: 'to', gust: 'target', energy: 'target', counter: 'target', pick: 'pick',
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
