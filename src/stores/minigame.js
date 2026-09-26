import { defineStore } from 'pinia'
import { answerMinigame, fetchMinigameState, startMinigame } from '@/api/challenge'
import { useAchievementsStore } from '@/stores/achievements'
import { useChallengeStore } from '@/stores/challenge'

// "Higher or lower" (challenge mode, migration 0013): paid runs left today,
// best streak and the run in progress. The server draws the pairs, checks
// the answers and pays; the wallet in the challenge store follows its numbers.
// `unavailable` = migration 0013 not applied yet: the hub hides the game.
const isMissingRpc = (err) => err?.code === 'PGRST202' || /could not find the function/i.test(err?.message ?? '')

export const useMinigameStore = defineStore('minigame', {
  state: () => ({
    state: null, // minigame_state() payload
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
        this.apply(await fetchMinigameState())
        this.loaded = true
      } catch (err) {
        if (isMissingRpc(err)) this.unavailable = true
        else this.error = err
      } finally {
        this.loading = false
      }
    },

    async start() {
      this.apply(await startMinigame())
    },

    /** @param {'left' | 'right' | null} pick - null = time's up */
    async answer(pick) {
      const result = await answerMinigame(pick)
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
