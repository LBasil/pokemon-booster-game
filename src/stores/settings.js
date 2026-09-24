import { defineStore } from 'pinia'

const STORAGE_KEY = 'settings'

function readSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {}
  } catch {
    return {}
  }
}

// Per-device preferences (sound effects, vibration), persisted locally
export const useSettingsStore = defineStore('settings', {
  state: () => ({
    sound: true,
    vibration: true,
    ...readSaved(),
  }),
  actions: {
    set(key, value) {
      this[key] = value
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ sound: this.sound, vibration: this.vibration }))
      } catch {
        // private mode: keep the setting for this visit only
      }
    },
  },
})
