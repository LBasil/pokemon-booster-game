import { defineStore } from 'pinia'
import { cashOutElectrodeFlip, fetchElectrodeFlipState, flipElectrodeTile, startElectrodeFlip } from '@/api/challenge'
import { useAchievementsStore } from '@/stores/achievements'
import { useChallengeStore } from '@/stores/challenge'

// "Shiny Electrode Flip" (challenge mode, migration 0014): level, coins left
// today, records and the board in progress. The server deals the board,
// reveals each tile and pays; the wallet in the challenge store follows its
// numbers. `unavailable` = migration 0014 not applied yet: "Coming soon".
const isMissingRpc = (err) => err?.code === 'PGRST202' || /could not find the function/i.test(err?.message ?? '')

export const useElectrodeFlipStore = defineStore('electrodeFlip', {
  state: () => ({
    state: null, // electrode_flip_state() payload
    loading: false,
    loaded: false,
    unavailable: false,
    error: null,
  }),
  getters: {
    board: (s) => s.state?.board ?? null,
    level: (s) => s.state?.level ?? 1,
    coinsLeft: (s) => s.state?.coins_left ?? 0,
    bestPoints: (s) => s.state?.best_points ?? 0,
  },
  actions: {
    async load() {
      if (this.loading) return
      this.loading = true
      this.error = null
      try {
        this.apply(await fetchElectrodeFlipState())
        this.loaded = true
      } catch (err) {
        if (isMissingRpc(err)) this.unavailable = true
        else this.error = err
      } finally {
        this.loading = false
      }
    },

    async start() {
      this.apply(await startElectrodeFlip())
    },

    /** @param {number} index - tile 0..24 */
    async flip(index) {
      const result = await flipElectrodeTile(index)
      this.ended(result)
      return result
    },

    async cashOut() {
      const result = await cashOutElectrodeFlip()
      this.ended(result)
      return result
    },

    ended(result) {
      this.apply(result.state)
      // Coins earned count for the economy achievements: toast them when a board ends
      if (result.result.status !== 'playing') useAchievementsStore().check('challenge')
    },

    apply(state) {
      this.state = state
      const challenge = useChallengeStore()
      if (challenge.state && typeof state?.coins === 'number') challenge.state = { ...challenge.state, coins: state.coins }
    },
  },
})
