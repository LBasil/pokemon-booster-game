import { defineStore } from 'pinia'
import {
  claimDailyReward,
  claimMission,
  craftCard,
  fetchChallengeBadge,
  fetchChallengeState,
  openChallengeBooster,
  recycleDuplicates,
} from '@/api/challenge'
import { useChallengeCollectionStore } from '@/stores/collection'
import { affordablePacks } from '@/utils/challenge'

// The signed-in player's challenge wallet: coins, daily reward
// and today's missions. Every change comes back from the server.
// `badge` = what's waiting (rewards + incoming trades) for the navigation.
const BADGE_TTL = 60_000
export const useChallengeStore = defineStore('challenge', {
  state: () => ({
    state: null, // challenge_state() payload
    loading: false,
    loaded: false,
    error: null,
    badge: { rewards: 0, trades: 0 },
    badgeAt: 0,
  }),
  getters: {
    coins: (s) => s.state?.coins ?? 0,
    missions: (s) => s.state?.missions ?? [],
    affordable: (s) => affordablePacks(s.state?.coins),
    // Missions done but not yet claimed + the daily reward: drives the hub badge
    pendingRewards: (s) =>
      (s.state?.daily_available ? 1 : 0) +
      (s.state?.missions ?? []).filter((m) => !m.claimed && m.progress >= m.target).length,
  },
  actions: {
    /** Refreshes the navigation badge (at most once a minute unless forced). */
    async loadBadge({ force = false } = {}) {
      if (!force && Date.now() - this.badgeAt < BADGE_TTL) return
      this.badgeAt = Date.now()
      try {
        this.badge = await fetchChallengeBadge()
      } catch {
        // before migration 0007, or offline: no badge
      }
    },

    async load({ force = false } = {}) {
      if ((this.loaded && !force) || this.loading) return
      this.loading = true
      this.error = null
      try {
        this.state = await fetchChallengeState()
        this.loaded = true
        this.loadBadge({ force: true })
      } catch (err) {
        this.error = err
      } finally {
        this.loading = false
      }
    },

    /** @returns {Promise<number>} coins earned */
    async claimDaily() {
      const next = await claimDailyReward()
      this.state = next
      this.loadBadge({ force: true })
      return next.reward
    },

    /** @returns {Promise<number>} coins earned */
    async claimMission(mission) {
      const next = await claimMission(mission)
      this.state = next
      this.loadBadge({ force: true })
      return next.reward
    },

    /** Buys and opens one pack; the wallet follows the server's numbers. */
    async openBooster(setId) {
      const result = await openChallengeBooster(setId)
      if (this.state) {
        this.state = { ...this.state, coins: result.coins }
      }
      // Mission progress changed server side
      this.loaded = false
      this.badgeAt = 0
      useChallengeCollectionStore().invalidate()
      return result
    },

    /** @returns {Promise<{ recycled: number, gained: number }>} */
    async recycle(cardId = null) {
      const result = await recycleDuplicates(cardId)
      if (this.state) this.state = { ...this.state, coins: result.coins }
      this.loaded = false
      this.badgeAt = 0
      if (result.recycled) await useChallengeCollectionStore().load({ force: true })
      return result
    },

    async craft(card) {
      const result = await craftCard(card.id)
      if (this.state) this.state = { ...this.state, coins: result.coins }
      await useChallengeCollectionStore().load({ force: true })
      return result
    },
  },
})
