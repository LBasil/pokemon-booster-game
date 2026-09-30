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
]

// PostgREST's answer for an RPC that doesn't exist yet
const MISSING_FUNCTION = 'PGRST202'

async function call(name, args) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) {
    if (CHALLENGE_ERRORS.includes(error.message)) throw Object.assign(new Error(error.message), { code: error.message })
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
 * status, unseen, created_at, resolved_at }. unseen (migration 0017) = an
 * answer to one of my offers I haven't seen yet.
 */
export const fetchTrades = () => call('my_trades')

/** A public player's challenge collection, same shape as fetchCollection() rows. */
export const fetchChallengeCollectionOf = (username) => call('challenge_collection_of', { p_username: username })

/** @returns {Promise<number>} the new offer's id */
export const proposeTrade = (username, offerIds, requestIds) =>
  call('propose_trade', { p_username: username, p_offer: offerIds, p_request: requestIds })

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
