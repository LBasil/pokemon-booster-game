import { defineStore } from 'pinia'
import { cancelTrade, fetchTrades, proposeTrade, respondTrade } from '@/api/challenge'
import { useChallengeStore } from '@/stores/challenge'
import { useChallengeCollectionStore } from '@/stores/collection'
import { groupTrades } from '@/utils/trades'

// The signed-in player's trade offers (challenge mode, migration 0007).
// The server moves the cards; every action reloads the list.
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

    async cancel(tradeId) {
      await cancelTrade(tradeId)
      await this.refresh()
    },
  },
})
