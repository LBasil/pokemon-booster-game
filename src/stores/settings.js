import { defineStore } from 'pinia'

const STORAGE_KEY = 'settings'
const KEYS = ['sound', 'vibration', 'effects', 'animations']

// Booster animations: 'full' (3D flip, tear along the zigzag, glows), 'light'
// (2D only: fades and slides, no blur or blend layers — phones' GPUs choked on
// the full ones) or 'auto' = light on touch screens
export const ANIMATION_MODES = ['auto', 'full', 'light']

function readSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {}
  } catch {
    return {}
  }
}

const isTouchScreen = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

// Per-device preferences (sound effects, vibration, visual effects), persisted locally
export const useSettingsStore = defineStore('settings', {
  state: () => ({
    sound: true,
    vibration: true,
    // Pointer glow/ring/sparks and page transitions (PointerFx, App.vue)
    effects: true,
    animations: 'auto',
    ...readSaved(),
  }),
  getters: {
    liteAnimations: (state) => state.animations === 'light' || (state.animations !== 'full' && isTouchScreen()),
  },
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
