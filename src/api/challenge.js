import { supabase } from '@/lib/supabaseClient'

// Challenge mode RPCs (migration 0005). The server owns every coin: these
// calls never send amounts, only what the player wants to do.

// Messages raised by the RPCs, for friendly errors (challenge.errors.* keys)
export const CHALLENGE_ERRORS = [
  'not_enough_coins',
  'already_claimed',
  'mission_incomplete',
  // trades (migration 0007)
  'trainer_not_found',
  'cannot_trade_with_yourself',
  'invalid_trade',
  'cards_not_owned',
  'too_many_trades',
  'trade_not_found',
  'trade_closed',
  'trade_expired',
  // trade preferences (migration 0012)
  'trades_closed',
  'card_not_for_trade',
  // mini-game (migration 0013)
  'no_game',
  'slow_down',
  'minigame_unavailable',
  // Shiny Electrode Flip (migration 0014)
  'invalid_tile',
  'already_flipped',
  'nothing_to_cash',
  // "Super effective!" (migration 0015)
  'super_effective_unavailable',
  // "Evolution chain" (migration 0018)
  'evolution_chain_unavailable',
  // recycling some copies (migration 0020)
  'recycle_copies_unavailable',
  // counter-offers (migration 0021)
  'counter_unavailable',
  // PvP battles (migrations 0024 + 0025)
  'pvp_invalid_format',
  'pvp_invalid_deck',
  'pvp_no_deck',
  'pvp_no_opponent',
  'pvp_no_battles_left',
  'pvp_invalid_card',
  'pvp_invalid_attack',
  'pvp_not_enough_energy',
  // attack and defense decks (migration 0026)
  'pvp_invalid_role',
  'pvp_invalid_energy',
  'pvp_roles_unavailable',
  // bots (migration 0027)
  'pvp_invalid_level',
  'pvp_no_bot_battles_left',
  'pvp_no_bot_deck',
  'pvp_bots_unavailable',
  // testers only (migration 0028), Pocket-style battles (migration 0030)
  'pvp_closed',
  'pvp_not_your_turn',
  'pvp_invalid_action',
  'pvp_bench_full',
  'pvp_cannot_evolve_yet',
  'pvp_no_energy',
  'pvp_cannot_retreat',
  'pvp_cannot_attack',
]

// PostgREST's answer for an RPC that doesn't exist yet
const MISSING_FUNCTION = 'PGRST202'

async function call(name, args) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) {
    // "pvp_cannot_attack: energy": the code, then why
    const code = CHALLENGE_ERRORS.find((known) => error.message === known || error.message?.startsWith(`${known}: `))
    if (code) throw Object.assign(new Error(error.message), { code })
    throw error
  }
  return data
}

/** Wallet, daily reward and today's missions (creates the wallet on first visit). */
export const fetchChallengeState = () => call('challenge_state')

export const claimDailyReward = () => call('claim_daily_reward')

export const claimMission = (mission) => call('claim_mission', { p_mission: mission })

/**
 * Buys and opens one challenge pack.
 * @returns {Promise<{ cards: object[], coins: number, god_pack: boolean }>}
 */
export const openChallengeBooster = (setId) => call('open_challenge_booster', { p_set_id: setId })

/** Recycles every duplicate of one card, or of every card when `cardId` is null. */
export const recycleDuplicates = (cardId = null) => call('recycle_duplicates', { p_card_id: cardId })

/**
 * Recycles every duplicate of the picked cards only (migration 0017).
 * Before 0017, one recycle_duplicates() call per card, added up.
 * @returns {Promise<{ recycled: number, gained: number, coins: number }>}
 */
export async function recycleCards(cardIds) {
  try {
    return await call('recycle_cards', { p_card_ids: cardIds })
  } catch (err) {
    if (err?.code !== MISSING_FUNCTION) throw err
  }
  const total = { recycled: 0, gained: 0, coins: null }
  for (const cardId of cardIds) {
    const result = await recycleDuplicates(cardId)
    total.recycled += result.recycled
    total.gained += result.gained
    total.coins = result.coins
  }
  return total
}

/**
 * Recycles some copies of the picked cards (migration 0020): `picks` maps a
 * card id to the copies to recycle, `extras` to its duplicates. Before 0020
 * only "every duplicate" exists: fine when every pick takes them all,
 * otherwise recycle_copies_unavailable.
 * @param {Record<string, number>} picks
 * @param {Record<string, number>} extras
 * @returns {Promise<{ recycled: number, gained: number, coins: number }>}
 */
export async function recycleCopies(picks, extras) {
  try {
    return await call('recycle_card_copies', { p_picks: picks })
  } catch (err) {
    if (err?.code !== MISSING_FUNCTION) throw err
  }
  const ids = Object.keys(picks)
  if (ids.some((id) => picks[id] < extras[id])) {
    throw Object.assign(new Error('recycle_copies_unavailable'), { code: 'recycle_copies_unavailable' })
  }
  return recycleCards(ids)
}

export const craftCard = (cardId) => call('craft_card', { p_card_id: cardId })

/**
 * What's waiting (never creates a wallet): { rewards, trades, answers }.
 * answers = my offers answered since I last looked (migration 0017, 0 before).
 */
export async function fetchChallengeBadge() {
  const badge = await call('challenge_badge')
  return { rewards: 0, trades: 0, answers: 0, ...badge }
}

// ---------- Trades (migration 0007) ----------

/**
 * The player's 50 latest offers: { id, direction, partner, offer, request,
 * status, unseen, counter_of, created_at, resolved_at }. counter_of
 * (migration 0021) = the offer this one answers, status 'countered' = answered
 * by a counter-offer. unseen (migration 0017) = an
 * answer to one of my offers I haven't seen yet.
 */
export const fetchTrades = () => call('my_trades')

/** A public player's challenge collection, same shape as fetchCollection() rows. */
export const fetchChallengeCollectionOf = (username) => call('challenge_collection_of', { p_username: username })

/**
 * Who could trade me this card (migration 0022): public players who accept
 * trades and own 2+ copies of it in their challenge collection, not kept
 * out of trades; [{ username, quantity }], 20 at most. null before 0022.
 */
export async function fetchCardTraders(cardId) {
  try {
    return await call('card_traders', { p_card_id: cardId })
  } catch (err) {
    if (err?.code === MISSING_FUNCTION) return null
    throw err
  }
}

/** @returns {Promise<number>} the new offer's id */
export const proposeTrade = (username, offerIds, requestIds) =>
  call('propose_trade', { p_username: username, p_offer: offerIds, p_request: requestIds })

/**
 * Answers an offer I received with another one (migration 0021): the first
 * one ends as 'countered'. Before 0021: counter_unavailable.
 * @returns {Promise<number>} the counter-offer's id
 */
export async function counterTrade(tradeId, offerIds, requestIds) {
  try {
    return await call('counter_trade', { p_trade_id: tradeId, p_offer: offerIds, p_request: requestIds })
  } catch (err) {
    if (err?.code === MISSING_FUNCTION) throw Object.assign(new Error('counter_unavailable'), { code: 'counter_unavailable' })
    throw err
  }
}

/** @returns {Promise<{ status: 'accepted' | 'declined' | 'failed' }>} */
export const respondTrade = (tradeId, accept) => call('respond_trade', { p_trade_id: tradeId, p_accept: accept })

export const cancelTrade = (tradeId) => call('cancel_trade', { p_trade_id: tradeId })

/** The trades page was opened: every answer to my offers is seen (0 before migration 0017). */
export async function markTradeAnswersSeen() {
  try {
    return await call('mark_trade_answers_seen')
  } catch (err) {
    if (err?.code === MISSING_FUNCTION) return 0
    throw err
  }
}

/**
 * Live changes to the player's offers (migration 0011 puts trade_offers in
 * the supabase_realtime publication; RLS only sends the player's own).
 * Calls onChange(newRow) on any insert/update. Returns an unsubscribe function.
 */
export function subscribeToTrades(userId, onChange) {
  const channel = supabase
    .channel(`trades-${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'trade_offers' }, (payload) => onChange(payload.new))
    .subscribe()
  return () => supabase.removeChannel(channel)
}

// ---------- Cards not for trade (migration 0012) ----------

// PostgREST's answer for a table that doesn't exist yet
const MISSING_TABLE = 'PGRST205'

/** Ids of the player's challenge cards kept out of trades ([] before 0012). */
export async function fetchTradeLocks() {
  const { data, error } = await supabase.from('trade_locks').select('card_id')
  if (error?.code === MISSING_TABLE) return []
  if (error) throw error
  return data.map((row) => row.card_id)
}

// user_id defaults to auth.uid() in the database
export async function lockCard(cardId) {
  const { error } = await supabase.from('trade_locks').insert({ card_id: cardId })
  if (error && error.code !== '23505') throw error // already locked: fine
}

export async function unlockCard(cardId) {
  const { error } = await supabase.from('trade_locks').delete().eq('card_id', cardId)
  if (error) throw error
}

// ---------- "Higher or lower" mini-game (migration 0013) ----------

/**
 * Rules, paid runs left today, best streak and the run in progress (its two
 * cards come without their prices).
 */
export const fetchMinigameState = () => call('minigame_state')

/** Starts a run (abandoning the one in progress); returns the state. */
export const startMinigame = () => call('minigame_start')

/**
 * @param {'left' | 'right' | null} pick - null = time's up
 * @returns {Promise<{ correct: boolean, late: boolean, earned: number, streak: number, run_coins: number,
 *   left: { id: string, value: number }, right: { id: string, value: number }, state: object }>}
 */
export const answerMinigame = (pick) => call('minigame_answer', { p_pick: pick })

// ---------- "Shiny Electrode Flip" mini-game (migration 0014) ----------

/**
 * Rules, level, coins left today, records and the board in progress (its
 * hints, and only the tiles already flipped).
 */
export const fetchElectrodeFlipState = () => call('electrode_flip_state')

/** Deals a board (or returns the one in progress); returns the state. */
export const startElectrodeFlip = () => call('electrode_flip_start')

/**
 * @param {number} index - tile 0..24, row by row
 * @returns {Promise<{ index: number, value: number, earned: number, result: object, state: object }>}
 *   value 0 = an Electrode; result = the board after the flip (every tile once it's over)
 */
export const flipElectrodeTile = (index) => call('electrode_flip_flip', { p_index: index })

/** Ends the board, keeping its points. @returns {Promise<{ earned: number, result: object, state: object }>} */
export const cashOutElectrodeFlip = () => call('electrode_flip_cash_out')

// ---------- "Super effective!" mini-game (migration 0015) ----------

/**
 * Rules, whether cards are ready (weaknesses filled), paid runs left today,
 * best streak and the run in progress (its card comes without its weakness).
 */
export const fetchSuperEffectiveState = () => call('super_effective_state')

/** Starts a run (abandoning the one in progress); returns the state. */
export const startSuperEffective = () => call('super_effective_start')

/**
 * @param {string | null} pick - one of the run's options, null = time's up
 * @returns {Promise<{ correct: boolean, late: boolean, earned: number, streak: number, run_coins: number,
 *   answer: string, weaknesses: string[], state: object }>}
 */
export const answerSuperEffective = (pick) => call('super_effective_answer', { p_pick: pick })

// ---------- "Evolution chain" mini-game (migration 0018) ----------

/**
 * Rules, whether lines are ready (evolves_from filled), paid runs left today,
 * best streak and the run in progress (its cards come without their stages).
 */
export const fetchEvolutionChainState = () => call('evolution_chain_state')

/** Starts a run (abandoning the one in progress); returns the state. */
export const startEvolutionChain = () => call('evolution_chain_start')

/**
 * @param {string[] | null} order - `run.length` (2 or 3) of the shown card ids, Basic first; null = time's up
 * @returns {Promise<{ correct: boolean, late: boolean, earned: number, streak: number, run_coins: number,
 *   chain: string[], state: object }>}
 */
export const answerEvolutionChain = (order) => call('evolution_chain_answer', { p_order: order })

/**
 * Ends the run in progress (migration 0019): the coins earned stay.
 * @returns {Promise<{ streak: number, run_coins: number, state: object }>}
 */
export const stopEvolutionChain = () => call('evolution_chain_stop')

// ---------- PvP battles (migrations 0024 + 0025: energy, prizes; 0026: attack and defense decks) ----------

/**
 * Rules (`engine` 2 = Pocket-style, migration 0030; 3 = typed energy, 0031), whether the card data
 * is synced (`ready`), formats with my playable copies, my decks (ids) and
 * ratings per format, battles left today, the battle in progress and my
 * last 10 battles (attacks and defenses). Not a tester: `{ ready: false }`.
 */
export const fetchPvpState = () => call('pvp_state')

/** My challenge Pokémon that can be in a deck of a format ('all', 'era:<series>', 'set:<id>'), with `owned` copies. */
export const fetchPvpEligible = (format) => call('pvp_eligible', { p_format: format })

/**
 * Saves one of my decks (20 card ids, a card repeated per copy) for a
 * format: 'attack' (the one I play) or 'defense' (the one the server plays
 * when I'm attacked), with its 1 or 2 energy types (0031); returns the
 * state. Before 0031 the energy isn't sent.
 */
export async function savePvpDeck(format, cardIds, role = 'attack', energy = null) {
  const args = { p_format: format, p_cards: cardIds, p_role: role }
  if (!energy) return call('pvp_save_deck', args)
  try {
    return await call('pvp_save_deck', { ...args, p_energy: energy })
  } catch (err) {
    if (err?.code === MISSING_FUNCTION) return call('pvp_save_deck', args)
    throw err
  }
}

/** Finds an opponent and starts a battle (or returns the one in progress); returns the state. */
export const startPvpBattle = (format) => call('pvp_start', { p_format: format })

/**
 * Starts a battle against a bot ('easy' | 'normal' | 'hard') with my attack
 * deck (or returns the one in progress); returns the state. No Elo, coins
 * for the first wins of the day. Before 0027: `pvp_bots_unavailable`.
 */
export async function startPvpBotBattle(format, level) {
  try {
    return await call('pvp_bot_start', { p_format: format, p_level: level })
  } catch (err) {
    if (err?.code === MISSING_FUNCTION) throw Object.assign(new Error('pvp_bots_unavailable'), { code: 'pvp_bots_unavailable' })
    throw err
  }
}

/**
 * One move in the battle in progress (migration 0030): { type: 'setup',
 * active, bench }, 'bench' (card), 'evolve' (card, pos), 'attach' (pos),
 * 'retreat' (pos), 'attack' (attack, target?, switch_to?, energy_to?),
 * 'end', 'promote' (pos). Card = index in my cards, pos = 0 Active, 1-3 Bench.
 * The server then plays on until it's my move again.
 * @returns {Promise<{ battle: object, events: object[], state: object }>}
 */
export const pvpAct = (action) => call('pvp_act', { p_action: action })

/** Gives up the battle in progress (a loss). */
export const forfeitPvpBattle = () => call('pvp_forfeit')

/** @returns {Promise<{ rows: object[], me: object | null }>} top 20 public players of a format + my row */
export const fetchPvpLeaderboard = (format) => call('pvp_leaderboard', { p_format: format })
