import { defineStore } from 'pinia'
import {
  fetchPvpEligible,
  fetchPvpLeaderboard,
  fetchPvpState,
  forfeitPvpBattle,
  playPvpCard,
  savePvpDeck,
  startPvpBattle,
  startPvpBotBattle,
} from '@/api/challenge'
import { useAchievementsStore } from '@/stores/achievements'
import { useChallengeStore } from '@/stores/challenge'
import { useProfileStore } from '@/stores/profile'
import { deckRoles, pvpOpenTo } from '@/utils/pvp'

// PvP battles (challenge mode, migrations 0024 + 0025 + 0026 + 0027): my attack and
// defense decks and Elo per format,
// battles left today, the battle in progress and my history. The server
// picks the opponent, plays their deck and moves both ratings. Bots (0027):
// the server deals the deck, no Elo, coins (the header's wallet follows
// `state.coins`). `botsAvailable` false = 0027 not applied: no bot section.
// `unavailable` = migration 0024/0025 not applied yet, or no card has its attacks + costs
// yet (populate hasn't run since), or I'm not a tester (`pvpOpenTo`, the
// server checks it too since 0028): "Coming soon".
const isMissingRpc = (err) => err?.code === 'PGRST202' || /could not find the function/i.test(err?.message ?? '')

export const usePvpStore = defineStore('pvp', {
  state: () => ({
    state: null, // pvp_state() payload
    loading: false,
    loaded: false,
    unavailable: false,
    error: null,
    eligible: {}, // format -> my cards that can fight there
    boards: {}, // format -> pvp_leaderboard() payload
  }),
  getters: {
    battle: (s) => s.state?.battle ?? null,
    battlesLeft: (s) => s.state?.battles_left ?? 0,
    botsAvailable: (s) => typeof s.state?.bot_battles_left === 'number',
    botBattlesLeft: (s) => s.state?.bot_battles_left ?? 0,
    botPaidLeft: (s) => s.state?.bot_paid_left ?? 0,
    formats: (s) => s.state?.formats ?? { all: 0, eras: [], sets: [] },
    // format -> { attack, defense } (each { cards, valid } or null), whatever the server's version
    decks: (s) => Object.fromEntries(Object.entries(s.state?.decks ?? {}).map(([format, entry]) => [format, deckRoles(entry)])),
    ratings: (s) => s.state?.ratings ?? {},
    history: (s) => s.state?.history ?? [],
    /** Best Elo among the formats played, null before a battle. */
    bestElo: (s) => {
      const played = Object.values(s.state?.ratings ?? {}).filter(
        (r) => r.wins + r.losses + r.draws + r.def_wins + r.def_losses + r.def_draws > 0,
      )
      return played.length ? Math.max(...played.map((r) => r.elo)) : null
    },
  },
  actions: {
    async load() {
      if (this.loading) return
      this.loading = true
      this.error = null
      try {
        const profile = useProfileStore()
        await profile.load()
        // Already loading elsewhere (the header): wait for that load
        while (profile.loading) await new Promise((resolve) => setTimeout(resolve, 50))
        if (!pvpOpenTo(profile.profile?.username)) {
          this.unavailable = true
          this.loaded = true
          return
        }
        this.state = await fetchPvpState()
        this.unavailable = this.state?.ready === false
        this.loaded = true
      } catch (err) {
        if (isMissingRpc(err)) this.unavailable = true
        else this.error = err
      } finally {
        this.loading = false
      }
    },

    async loadEligible(format, { force = false } = {}) {
      if (!force && this.eligible[format]) return this.eligible[format]
      const cards = await fetchPvpEligible(format)
      this.eligible = { ...this.eligible, [format]: cards }
      return cards
    },

    /** @param {'attack' | 'defense'} role */
    async saveDeck(format, cardIds, role = 'attack') {
      this.state = await savePvpDeck(format, cardIds, role)
    },

    async start(format) {
      this.state = await startPvpBattle(format)
    },

    /** @param {'easy' | 'normal' | 'hard'} level */
    async startBot(format, level) {
      this.state = await startPvpBotBattle(format, level)
    },

    // A bot battle that paid: the header's coins follow the server, and
    // coins earned count for the economy achievements
    syncCoins() {
      const challenge = useChallengeStore()
      if (challenge.state && typeof this.state?.coins === 'number') challenge.state = { ...challenge.state, coins: this.state.coins }
      useAchievementsStore().check('challenge')
    },

    /**
     * @param {number} slot - my card (0-4)
     * @param {number | null} attack - index in the card's `attacks`, null = no attack
     * @returns {Promise<{ round: object, battle: object, state: object }>}
     */
    async play(slot, attack) {
      const result = await playPvpCard(slot, attack)
      this.state = result.state
      if (result.battle.status !== 'playing') {
        delete this.boards[result.battle.format]
        if (result.battle.coins) this.syncCoins()
      }
      return result
    },

    async forfeit() {
      const result = await forfeitPvpBattle()
      this.state = result.state
      delete this.boards[result.battle.format]
      return result
    },

    async loadBoard(format, { force = false } = {}) {
      if (!force && this.boards[format]) return this.boards[format]
      const board = await fetchPvpLeaderboard(format)
      this.boards = { ...this.boards, [format]: board }
      return board
    },
  },
})
