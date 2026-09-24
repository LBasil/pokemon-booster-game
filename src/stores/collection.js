import { defineStore } from 'pinia'
import { fetchCollection, fetchCollectionStats } from '@/api/collection'

export const useCollectionStore = defineStore('collection', {
  state: () => ({
    entries: [],
    stats: { uniqueOwned: 0, totalCards: 0 },
    loading: false,
    loaded: false,
    error: null,
  }),
  getters: {
    // Every card ever pulled, duplicates included
    totalDrawn: (state) => state.entries.reduce((sum, entry) => sum + entry.quantity, 0),
    // Entries come back newest first (see fetchCollection)
    recentEntries: (state) => state.entries.slice(0, 12),
  },
  actions: {
    async load({ force = false } = {}) {
      if (this.loaded && !force) return
      this.loading = true
      this.error = null
      try {
        const [entries, stats] = await Promise.all([fetchCollection(), fetchCollectionStats()])
        this.entries = entries
        this.stats = stats
        this.loaded = true
      } catch (err) {
        this.error = err
      } finally {
        this.loading = false
      }
    },
    invalidate() {
      this.loaded = false
    },
  },
})
