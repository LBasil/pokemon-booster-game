import { defineStore } from 'pinia'
import { fetchAchievementRates, fetchPlayerAchievements, recordAchievements } from '@/api/achievements'
import * as sfx from '@/lib/sfx'
import { useAuthStore } from '@/stores/auth'
import { useModeCollectionStore } from '@/stores/collection'
import { useSetsStore } from '@/stores/sets'
import { useSettingsStore } from '@/stores/settings'
import { achievements, newlyUnlocked, sortForToasts, toastBatch } from '@/utils/achievements'

// Achievements per game mode: unlock notifications ("Steam style" toasts),
// what the server knows about the player, and rarity rates.
//
// check(mode) recomputes the player's achievements from that mode's
// collection + the server's data (ids already unlocked, packs opened) and
// toasts those unlocked since the last check on this device (ids kept in
// localStorage per account and mode; the very first check is a silent
// baseline). It also reports unlocks to the server for the rates; ids the
// server has confirmed are remembered too, so a failed report (offline,
// migration missing) is retried on the next check.
const MODES = ['unlimited', 'challenge']
const RATES_TTL = 10 * 60 * 1000
const TOAST_MS = 6000

// Unlimited keeps its original (pre-modes) keys
const storageKey = (kind, mode, userId) =>
  mode === 'unlimited' ? `pb-achievements-${kind}:${userId}` : `pb-achievements-${kind}:${mode}:${userId}`

function readIds(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? new Set(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

function writeIds(key, ids) {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]))
  } catch {
    // private mode: baseline kept for this visit only (see memory below)
  }
}

// Fallback when localStorage is unavailable, so the same unlock isn't toasted twice
const memory = new Map()

let toastId = 0
const ratesPending = {}
const perMode = (value) => Object.fromEntries(MODES.map((mode) => [mode, value]))

export const useAchievementsStore = defineStore('achievements', {
  state: () => ({
    toasts: [], // [{ key, mode, item }] or [{ key, mode, more }] ("+N more")
    rates: perMode(null), // per mode: { players, holders } or null (unknown)
    ratesAt: perMode(0),
    // The player's own server data per mode: { unlocked: [...], packs } or null
    server: perMode(null),
  }),
  actions: {
    /** The player's own achievements in a mode (loads what's missing), or null. */
    async own(mode) {
      const auth = useAuthStore()
      const collection = useModeCollectionStore(mode)
      const sets = useSetsStore()
      const userId = auth.user?.id
      if (!userId) return null
      const [server] = await Promise.all([
        fetchPlayerAchievements(mode).catch(() => null),
        collection.load(),
        sets.load(),
      ])
      // Both needed: an unloaded list would unlock (and toast) old achievements later
      if (!collection.loaded || !sets.loaded || auth.user?.id !== userId) return null
      this.server[mode] = server
      return { userId, list: achievements(collection.entries, sets.sets, { mode, ...server }) }
    },

    async check(mode = 'unlimited') {
      const own = await this.own(mode)
      if (!own) return
      const { userId, list } = own
      const unlocked = list.filter((item) => item.unlocked).map((item) => item.id)
      const key = storageKey('seen', mode, userId)
      const seen = readIds(key) ?? memory.get(key) ?? null
      const fresh = newlyUnlocked(list, seen)
      const baseline = new Set([...(seen ?? []), ...unlocked])
      memory.set(key, baseline)
      writeIds(key, baseline)

      if (fresh.length) {
        await this.loadRates(mode) // rarest first, and the toasts show the rates
        this.notify(fresh, mode)
      }
      this.report(userId, mode, unlocked)
    },

    notify(items, mode) {
      const settings = useSettingsStore()
      sfx.achievement(settings.sound)
      sfx.buzz(settings.vibration, [20, 60, 20])
      toastBatch(sortForToasts(items, this.rates[mode])).forEach((toast, index) => {
        const key = ++toastId
        // They arrive one after the other
        setTimeout(() => {
          this.toasts.push({ key, mode, ...toast })
          setTimeout(() => this.dismiss(key), TOAST_MS)
        }, index * 450)
      })
    },

    dismiss(key) {
      this.toasts = this.toasts.filter((toast) => toast.key !== key)
    },

    async report(userId, mode, unlocked) {
      const key = storageKey('recorded', mode, userId)
      const recorded = readIds(key) ?? new Set()
      const missing = unlocked.filter((id) => !recorded.has(id))
      if (!missing.length) return
      try {
        await recordAchievements(missing, mode)
        writeIds(key, new Set([...recorded, ...missing]))
        if (this.rates[mode]) this.loadRates(mode, { force: true }) // own unlocks now count
      } catch {
        // offline or migration missing: retried on the next check
      }
    },

    // Throttled per mode; concurrent callers share the request in flight
    loadRates(mode = 'unlimited', { force = false } = {}) {
      if (ratesPending[mode] && !force) return ratesPending[mode]
      if (!force && Date.now() - this.ratesAt[mode] < RATES_TTL) return Promise.resolve()
      this.ratesAt[mode] = Date.now()
      ratesPending[mode] = fetchAchievementRates(mode)
        .then((rates) => (this.rates[mode] = rates))
        .catch(() => (this.rates[mode] = null))
        .finally(() => (ratesPending[mode] = null))
      return ratesPending[mode]
    },
  },
})
