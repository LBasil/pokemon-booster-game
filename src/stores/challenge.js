import { defineStore } from 'pinia'
import {
  claimDailyReward,
  claimMission,
  craftCard,
  fetchChallengeState,
  openChallengeBooster,
  recycleDuplicates,
} from '@/api/challenge'
import { useChallengeCollectionStore } from '@/stores/collection'
import { affordablePacks } from '@/utils/challenge'

// The signed-in player's challenge wallet: coins, daily reward
// and today's missions. Every change comes back from the server.
export const useChallengeStore = defineStore('challenge', {
  state: () => ({
    state: null, // challenge_state() payload
    loading: false,
    loaded: false,
    error: null,
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
    async load({ force = false } = {}) {
      if ((this.loaded && !force) || this.loading) return
      this.loading = true
      this.error = null
      try {
        this.state = await fetchChallengeState()
        this.loaded = true
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
      return next.reward
    },

    /** @returns {Promise<number>} coins earned */
    async claimMission(mission) {
      const next = await claimMission(mission)
      this.state = next
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
      useChallengeCollectionStore().invalidate()
      return result
    },

    /** @returns {Promise<{ recycled: number, gained: number }>} */
    async recycle(cardId = null) {
      const result = await recycleDuplicates(cardId)
      if (this.state) this.state = { ...this.state, coins: result.coins }
      this.loaded = false
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
