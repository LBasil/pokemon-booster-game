import { defineStore } from 'pinia'
import {
  fetchPvpEligible,
  fetchPvpLeaderboard,
  fetchPvpState,
  forfeitPvpBattle,
  playPvpCard,
  savePvpDeck,
  startPvpBattle,
} from '@/api/challenge'
import { deckRoles } from '@/utils/pvp'

// PvP battles (challenge mode, migrations 0024 + 0025 + 0026): my attack and
// defense decks and Elo per format,
// battles left today, the battle in progress and my history. The server
// picks the opponent, plays their deck and moves both ratings.
// `unavailable` = migration 0024/0025 not applied yet, or no card has its attacks + costs
// yet (populate hasn't run since): "Coming soon".
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

    /**
     * @param {number} slot - my card (0-4)
     * @param {number | null} attack - index in the card's `attacks`, null = no attack
     * @returns {Promise<{ round: object, battle: object, state: object }>}
     */
    async play(slot, attack) {
      const result = await playPvpCard(slot, attack)
      this.state = result.state
      if (result.battle.status !== 'playing') delete this.boards[result.battle.format]
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
