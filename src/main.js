import { createApp } from 'vue'
import { createPinia } from 'pinia'

import 'bootstrap/dist/css/bootstrap.min.css'
import '@/assets/styles/global.css'

import App from './App.vue'
import router from './router'
import { i18n } from './i18n'
import { useThemeStore } from '@/stores/theme'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(i18n)

useThemeStore().init()

app.mount('#app')
