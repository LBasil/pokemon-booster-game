import { defineStore } from 'pinia'
import { cancelTrade, fetchTrades, proposeTrade, respondTrade, subscribeToTrades } from '@/api/challenge'
import { useChallengeStore } from '@/stores/challenge'
import { useChallengeCollectionStore } from '@/stores/collection'
import { groupTrades } from '@/utils/trades'

// The signed-in player's trade offers (challenge mode, migration 0007).
// The server moves the cards; every action reloads the list, and so does
// any change pushed by Realtime (live(), started by App.vue once signed in).
export const useTradesStore = defineStore('trades', {
  state: () => ({
    trades: [],
    loading: false,
    loaded: false,
    error: null,
  }),
  getters: {
    groups: (state) => groupTrades(state.trades),
  },
  actions: {
    async load({ force = false } = {}) {
      if ((this.loaded && !force) || this.loading) return
      this.loading = true
      this.error = null
      try {
        this.trades = await fetchTrades()
        this.loaded = true
      } catch (err) {
        this.error = err
      } finally {
        this.loading = false
      }
    },

    async refresh() {
      await this.load({ force: true })
      useChallengeStore().loadBadge({ force: true })
    },

    async propose(username, offerIds, requestIds) {
      await proposeTrade(username, offerIds, requestIds)
      await this.refresh()
    },

    /** @returns {Promise<'accepted' | 'declined' | 'failed'>} */
    async respond(tradeId, accept) {
      const { status } = await respondTrade(tradeId, accept)
      if (status === 'accepted') await useChallengeCollectionStore().load({ force: true })
      await this.refresh()
      return status
    },

    /**
     * Follows the player's offers live: the badge always, the list once it
     * was loaded, and the challenge collection when a swap went through.
     * Returns the unsubscribe function.
     */
    live(userId) {
      return subscribeToTrades(userId, (row) => {
        useChallengeStore().loadBadge({ force: true })
        if (this.loaded) this.load({ force: true })
        if (row?.status === 'accepted') useChallengeCollectionStore().invalidate()
      })
    },

    async cancel(tradeId) {
      await cancelTrade(tradeId)
      await this.refresh()
    },
  },
})
