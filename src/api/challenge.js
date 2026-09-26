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
]

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

export const craftCard = (cardId) => call('craft_card', { p_card_id: cardId })

/** What's waiting: { rewards, trades } (never creates a wallet). */
export const fetchChallengeBadge = () => call('challenge_badge')

// ---------- Trades (migration 0007) ----------

/** The player's 50 latest offers: { id, direction, partner, offer, request, status, created_at, resolved_at }. */
export const fetchTrades = () => call('my_trades')

/** A public player's challenge collection, same shape as fetchCollection() rows. */
export const fetchChallengeCollectionOf = (username) => call('challenge_collection_of', { p_username: username })

/** @returns {Promise<number>} the new offer's id */
export const proposeTrade = (username, offerIds, requestIds) =>
  call('propose_trade', { p_username: username, p_offer: offerIds, p_request: requestIds })

/** @returns {Promise<{ status: 'accepted' | 'declined' | 'failed' }>} */
export const respondTrade = (tradeId, accept) => call('respond_trade', { p_trade_id: tradeId, p_accept: accept })

export const cancelTrade = (tradeId) => call('cancel_trade', { p_trade_id: tradeId })

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
