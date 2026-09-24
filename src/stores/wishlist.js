import { defineStore } from 'pinia'
import { addToWishlist, fetchWishlist, removeFromWishlist } from '@/api/wishlist'

// Cards the player is hunting. The server drops a card from the list when
// it's pulled (open_my_booster), so the list is reloaded after openings.
export const useWishlistStore = defineStore('wishlist', {
  state: () => ({
    entries: [],
    loading: false,
    loaded: false,
    error: null,
  }),
  getters: {
    ids: (state) => new Set(state.entries.map((entry) => entry.card_id)),
  },
  actions: {
    async load({ force = false } = {}) {
      if ((this.loaded && !force) || this.loading) return
      this.loading = true
      this.error = null
      try {
        this.entries = await fetchWishlist()
        this.loaded = true
      } catch (err) {
        this.error = err
      } finally {
        this.loading = false
      }
    },

    has(cardId) {
      return this.ids.has(cardId)
    },

    /** Adds or removes a card; `card` is kept locally so lists update instantly. */
    async toggle(card) {
      if (this.has(card.id)) {
        await removeFromWishlist(card.id)
        this.entries = this.entries.filter((entry) => entry.card_id !== card.id)
      } else {
        await addToWishlist(card.id)
        this.entries = [{ card_id: card.id, created_at: new Date().toISOString(), cards: card }, ...this.entries]
      }
    },

    invalidate() {
      this.loaded = false
    },
  },
})
