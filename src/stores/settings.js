import { defineStore } from 'pinia'

const STORAGE_KEY = 'settings'
const KEYS = ['sound', 'vibration', 'effects']

function readSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {}
  } catch {
    return {}
  }
}

// Per-device preferences (sound effects, vibration, visual effects), persisted locally
export const useSettingsStore = defineStore('settings', {
  state: () => ({
    sound: true,
    vibration: true,
    // Pointer glow/ring/sparks and page transitions (PointerFx, App.vue)
    effects: true,
    ...readSaved(),
  }),
  actions: {
    set(key, value) {
      this[key] = value
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(KEYS.map((name) => [name, this[name]]))))
      } catch {
        // private mode: keep the setting for this visit only
      }
    },
  },
})
