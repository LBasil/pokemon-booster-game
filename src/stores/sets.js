import { defineStore } from 'pinia'
import { fetchSets } from '@/api/sets'

// The set list (176 rows, rarely changes): loaded once, shared by the booster
// picker and the collection.
let pending = null

export const useSetsStore = defineStore('sets', {
  state: () => ({
    sets: [],
    loading: false,
    loaded: false,
    error: null,
  }),
  getters: {
    byId: (state) => Object.fromEntries(state.sets.map((set) => [set.id, set])),
  },
  actions: {
    // Concurrent callers share the same request (and can await it)
    load() {
      if (this.loaded) return Promise.resolve()
      pending ??= (async () => {
        this.loading = true
        this.error = null
        try {
          this.sets = await fetchSets()
          this.loaded = true
        } catch (err) {
          this.error = err
        } finally {
          this.loading = false
          pending = null
        }
      })()
      return pending
    },
  },
})
