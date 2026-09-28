import { defineStore } from 'pinia'
import { answerSuperEffective, fetchSuperEffectiveState, startSuperEffective } from '@/api/challenge'
import { useAchievementsStore } from '@/stores/achievements'
import { useChallengeStore } from '@/stores/challenge'

// "Super effective!" (challenge mode, migration 0015): paid runs left today,
// best streak and the run in progress. The server draws the cards, checks
// the answers and pays; the wallet in the challenge store follows its numbers.
// `unavailable` = migration 0015 not applied yet, or no card has its
// weaknesses yet (populate hasn't run since): "Coming soon".
const isMissingRpc = (err) => err?.code === 'PGRST202' || /could not find the function/i.test(err?.message ?? '')

export const useSuperEffectiveStore = defineStore('superEffective', {
  state: () => ({
    state: null, // super_effective_state() payload
    loading: false,
    loaded: false,
    unavailable: false,
    error: null,
  }),
  getters: {
    run: (s) => s.state?.run ?? null,
    paidLeft: (s) => s.state?.paid_left ?? 0,
    best: (s) => s.state?.best ?? 0,
  },
  actions: {
    async load() {
      if (this.loading) return
      this.loading = true
      this.error = null
      try {
        this.apply(await fetchSuperEffectiveState())
        this.unavailable = this.state?.ready === false
        this.loaded = true
      } catch (err) {
        if (isMissingRpc(err)) this.unavailable = true
        else this.error = err
      } finally {
        this.loading = false
      }
    },

    async start() {
      this.apply(await startSuperEffective())
    },

    /** @param {string | null} pick - one of the run's options, null = time's up */
    async answer(pick) {
      const result = await answerSuperEffective(pick)
      this.apply(result.state)
      // Coins earned count for the economy achievements: toast them when the run ends
      if (!result.correct) useAchievementsStore().check('challenge')
      return result
    },

    apply(state) {
      this.state = state
      const challenge = useChallengeStore()
      if (challenge.state && typeof state?.coins === 'number') challenge.state = { ...challenge.state, coins: state.coins }
    },
  },
})
