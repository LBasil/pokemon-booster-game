import { supabase } from '@/lib/supabaseClient'

// Challenge mode RPCs (migration 0005). The server owns every coin: these
// calls never send amounts, only what the player wants to do.

// Messages raised by the RPCs, for friendly errors
export const CHALLENGE_ERRORS = ['not_enough_coins', 'already_claimed', 'mission_incomplete']

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
 * @returns {Promise<{ cards: object[], coins: number, packs_since_hit: number, god_pack: boolean, pity: boolean }>}
 */
export const openChallengeBooster = (setId) => call('open_challenge_booster', { p_set_id: setId })

/** Recycles every duplicate of one card, or of every card when `cardId` is null. */
export const recycleDuplicates = (cardId = null) => call('recycle_duplicates', { p_card_id: cardId })

export const craftCard = (cardId) => call('craft_card', { p_card_id: cardId })
