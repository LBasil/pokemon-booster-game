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

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(i18n)

useThemeStore().init()

setupPwa()
if (import.meta.env.PROD) watchAppVersion()

app.mount('#app')
