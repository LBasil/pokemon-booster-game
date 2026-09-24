import { defineStore } from 'pinia'

const STORAGE_KEY = 'theme'

function initialIsLight() {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) return stored === 'light'
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ?? false
}

// data-bs-theme drives both Bootstrap's components and our --pb-* tokens
function applyTheme(isLight) {
  document.documentElement.dataset.bsTheme = isLight ? 'light' : 'dark'
}

export const useThemeStore = defineStore('theme', {
  state: () => ({
    isLight: initialIsLight(),
  }),
  actions: {
    init() {
      applyTheme(this.isLight)
    },
    setLight(isLight) {
      this.isLight = isLight
      localStorage.setItem(STORAGE_KEY, isLight ? 'light' : 'dark')
      applyTheme(isLight)
    },
    toggle() {
      this.setLight(!this.isLight)
    },
  },
})
