import { defineStore } from 'pinia'
import { fetchCollection, fetchCollectionStats } from '@/api/collection'

export const useCollectionStore = defineStore('collection', {
  state: () => ({
    entries: [],
    stats: { uniqueOwned: 0, totalCards: 0 },
    loading: false,
    loaded: false,
  }),
  actions: {
    async load({ force = false } = {}) {
      if (this.loaded && !force) return
      this.loading = true
      try {
        const [entries, stats] = await Promise.all([fetchCollection(), fetchCollectionStats()])
        this.entries = entries
        this.stats = stats
        this.loaded = true
      } finally {
        this.loading = false
      }
    },
    invalidate() {
      this.loaded = false
    },
  },
})
