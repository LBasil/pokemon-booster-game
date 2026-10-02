import { defineStore } from 'pinia'
import {
  cancelTrade,
  counterTrade,
  fetchTradeLocks,
  fetchTrades,
  lockCard,
  markTradeAnswersSeen,
  proposeTrade,
  respondTrade,
  subscribeToTrades,
  unlockCard,
} from '@/api/challenge'
import { useAchievementsStore } from '@/stores/achievements'
import { useChallengeStore } from '@/stores/challenge'
import { useChallengeCollectionStore } from '@/stores/collection'
import { groupTrades, tradeNews } from '@/utils/trades'

// The signed-in player's trade offers (challenge mode, migration 0007).
// The server moves the cards; every action reloads the list, and so does
// any change pushed by Realtime (live(), started by App.vue once signed in).
// Live news (a new offer for me, an answer to mine) also pops a toast,
// shown by AchievementToasts next to the achievement ones.
const TOAST_MS = 8000
// Toasted this session (`trade:${id}:${news}`): Realtime can repeat an event
const toasted = new Set()

export const useTradesStore = defineStore('trades', {
  state: () => ({
    trades: [],
    loading: false,
    loaded: false,
    error: null,
    // Challenge cards kept out of trades (migration 0012), by card id
    locks: [],
    locksLoaded: false,
    toasts: [], // [{ key, news: 'offer' | 'counter' | 'accepted' | 'declined' | 'failed', partner }]
  }),
  getters: {
    groups: (state) => groupTrades(state.trades),
    isLocked: (state) => (cardId) => state.locks.includes(cardId),
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

    /** Answers a received offer with another one (migration 0021). */
    async counter(tradeId, offerIds, requestIds) {
      await counterTrade(tradeId, offerIds, requestIds)
      await this.refresh()
    },

    /** @returns {Promise<'accepted' | 'declined' | 'failed'>} */
    async respond(tradeId, accept) {
      const { status } = await respondTrade(tradeId, accept)
      if (status === 'accepted') {
        await useChallengeCollectionStore().load({ force: true })
        useAchievementsStore().check('challenge') // trades, new cards
      }
      await this.refresh()
      return status
    },

    /**
     * Follows the player's offers live: the badge always, the list once it
     * was loaded (or to name the partner of some news), the challenge
     * collection when a swap went through, and a toast for news.
     * Returns the unsubscribe function.
     */
    live(userId) {
      return subscribeToTrades(userId, async (row) => {
        useChallengeStore().loadBadge({ force: true })
        const news = tradeNews(row, userId)
        if (this.loaded || news) await this.load({ force: true })
        if (row?.status === 'accepted') {
          useChallengeCollectionStore().invalidate()
          useAchievementsStore().check('challenge') // an offer of ours went through
        }
        if (news) this.notify(row.id, news)
      })
    },

    notify(tradeId, news) {
      const key = `trade:${tradeId}:${news}`
      if (toasted.has(key)) return
      toasted.add(key)
      const partner = this.trades.find((trade) => trade.id === tradeId)?.partner ?? null
      this.toasts.push({ key, news, partner })
      setTimeout(() => this.dismiss(key), TOAST_MS)
    },

    dismiss(key) {
      this.toasts = this.toasts.filter((toast) => toast.key !== key)
    },

    /** The trades page shows the answers to my offers: they're seen (badge cleared). */
    async markSeen() {
      if (!this.trades.some((trade) => trade.unseen)) return
      try {
        await markTradeAnswersSeen()
      } catch {
        // offline: the badge stays until the next visit
      }
      useChallengeStore().loadBadge({ force: true })
    },

    async loadLocks({ force = false } = {}) {
      if (this.locksLoaded && !force) return
      try {
        this.locks = await fetchTradeLocks()
        this.locksLoaded = true
      } catch {
        // offline: nothing shown as locked, the server still enforces it
      }
    },

    /** Keeps a card out of trades, or lets it back in (optimistic). */
    async toggleLock(cardId) {
      const locked = this.locks.includes(cardId)
      this.locks = locked ? this.locks.filter((id) => id !== cardId) : [...this.locks, cardId]
      try {
        await (locked ? unlockCard(cardId) : lockCard(cardId))
      } catch (err) {
        this.locks = locked ? [...this.locks, cardId] : this.locks.filter((id) => id !== cardId)
        throw err
      }
    },

    async cancel(tradeId) {
      await cancelTrade(tradeId)
      await this.refresh()
    },
  },
})
