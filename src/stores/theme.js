import { defineStore } from 'pinia'

const STORAGE_KEY = 'theme'

function applyTheme(isLight) {
  document.body.classList.toggle('light-mode', isLight)
}

export const useThemeStore = defineStore('theme', {
  state: () => ({
    isLight: localStorage.getItem(STORAGE_KEY) === 'light',
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
