import { defineStore } from 'pinia'
import { fetchAchievementRates, recordAchievements } from '@/api/achievements'
import * as sfx from '@/lib/sfx'
import { useAuthStore } from '@/stores/auth'
import { useCollectionStore } from '@/stores/collection'
import { useSetsStore } from '@/stores/sets'
import { useSettingsStore } from '@/stores/settings'
import { achievements, newlyUnlocked, sortForToasts, toastBatch } from '@/utils/achievements'

// Unlock notifications ("Steam style" toasts) and rarity rates.
//
// check() recomputes the player's achievements from the unlimited collection
// and toasts those unlocked since the last check on this device (ids kept in
// localStorage per account; the very first check is a silent baseline). It
// also reports unlocks to the server (migration 0008) for the rates; ids the
// server has confirmed are remembered too, so a failed report (0008 not
// applied yet, offline) is retried on the next check.
const RATES_TTL = 10 * 60 * 1000
const TOAST_MS = 6000

const seenKey = (userId) => `pb-achievements-seen:${userId}`
const recordedKey = (userId) => `pb-achievements-recorded:${userId}`

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
let ratesPending = null

export const useAchievementsStore = defineStore('achievements', {
  state: () => ({
    toasts: [], // [{ key, item }] or [{ key, more }] ("+N more")
    rates: null, // { players, holders } or null (unknown)
    ratesAt: 0,
  }),
  actions: {
    async check() {
      const auth = useAuthStore()
      const collection = useCollectionStore()
      const sets = useSetsStore()
      const userId = auth.user?.id
      if (!userId) return
      await Promise.all([collection.load(), sets.load()])
      // Both needed: an unloaded list would unlock (and toast) old achievements later
      if (!collection.loaded || !sets.loaded || auth.user?.id !== userId) return

      const list = achievements(collection.entries, sets.sets)
      const unlocked = list.filter((item) => item.unlocked).map((item) => item.id)
      const seen = readIds(seenKey(userId)) ?? memory.get(userId) ?? null
      const fresh = newlyUnlocked(list, seen)
      const baseline = new Set([...(seen ?? []), ...unlocked])
      memory.set(userId, baseline)
      writeIds(seenKey(userId), baseline)

      if (fresh.length) {
        await this.loadRates() // rarest first, and the toasts show the rates
        this.notify(fresh)
      }
      this.report(userId, unlocked)
    },

    notify(items) {
      const settings = useSettingsStore()
      sfx.achievement(settings.sound)
      sfx.buzz(settings.vibration, [20, 60, 20])
      toastBatch(sortForToasts(items, this.rates)).forEach((toast, index) => {
        const key = ++toastId
        // They arrive one after the other
        setTimeout(() => {
          this.toasts.push({ key, ...toast })
          setTimeout(() => this.dismiss(key), TOAST_MS)
        }, index * 450)
      })
    },

    dismiss(key) {
      this.toasts = this.toasts.filter((toast) => toast.key !== key)
    },

    async report(userId, unlocked) {
      const recorded = readIds(recordedKey(userId)) ?? new Set()
      const missing = unlocked.filter((id) => !recorded.has(id))
      if (!missing.length) return
      try {
        await recordAchievements(missing)
        writeIds(recordedKey(userId), new Set([...recorded, ...missing]))
        if (this.rates) this.loadRates({ force: true }) // own unlocks now count
      } catch {
        // 0008 not applied yet or offline: retried on the next check
      }
    },

    // Throttled; concurrent callers share the request in flight
    loadRates({ force = false } = {}) {
      if (ratesPending && !force) return ratesPending
      if (!force && Date.now() - this.ratesAt < RATES_TTL) return Promise.resolve()
      this.ratesAt = Date.now()
      ratesPending = fetchAchievementRates()
        .then((rates) => (this.rates = rates))
        .catch(() => (this.rates = null))
        .finally(() => (ratesPending = null))
      return ratesPending
    },
  },
})
