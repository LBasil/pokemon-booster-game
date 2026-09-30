import { defineStore } from 'pinia'
import { answerEvolutionChain, fetchEvolutionChainState, startEvolutionChain } from '@/api/challenge'
import { useAchievementsStore } from '@/stores/achievements'
import { useChallengeStore } from '@/stores/challenge'

// "Evolution chain" (challenge mode, migration 0018): paid runs left today,
// best streak and the run in progress. The server draws the lines, checks
// the answers and pays; the wallet in the challenge store follows its numbers.
// `unavailable` = migration 0018 not applied yet, or no card has its
// evolves_from yet (populate hasn't run since): "Coming soon".
const isMissingRpc = (err) => err?.code === 'PGRST202' || /could not find the function/i.test(err?.message ?? '')

export const useEvolutionChainStore = defineStore('evolutionChain', {
  state: () => ({
    state: null, // evolution_chain_state() payload
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
        this.apply(await fetchEvolutionChainState())
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
      this.apply(await startEvolutionChain())
    },

    /** @param {string[] | null} order - 3 card ids, Basic first; null = time's up */
    async answer(order) {
      const result = await answerEvolutionChain(order)
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
