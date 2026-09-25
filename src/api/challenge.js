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
