import { createApp } from 'vue'
import { createPinia } from 'pinia'

import 'bootstrap/dist/css/bootstrap.min.css'
import '@/assets/styles/global.css'

import App from './App.vue'
import router from './router'
import { i18n } from './i18n'
import { useThemeStore } from '@/stores/theme'
import { setupPwa } from '@/lib/pwa'
import { watchAppVersion } from '@/lib/appVersion'

// A French card image (TCGdex) that fails to load falls back to the English
// one in its data-fallback (useCardLocale)
document.addEventListener(
  'error',
  (event) => {
    const img = event.target
    if (!(img instanceof HTMLImageElement) || !img.dataset.fallback || img.src === img.dataset.fallback) return
    img.removeAttribute('srcset')
    img.src = img.dataset.fallback
  },
  true,
)

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(i18n)

useThemeStore().init()

setupPwa()
if (import.meta.env.PROD) watchAppVersion()

app.mount('#app')
