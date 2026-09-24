import { ref } from 'vue'

// Chrome/Edge/Android fire `beforeinstallprompt` when the app is installable;
// we keep it so an "Install the app" button can trigger it later.
export const installPrompt = ref(null)
export const installed = ref(
  typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches,
)

export function setupPwa() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    installPrompt.value = event
  })
  window.addEventListener('appinstalled', () => {
    installed.value = true
    installPrompt.value = null
  })
  // Only in production builds: a dev server + service worker caches get confusing
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'))
  }
}

export async function promptInstall() {
  const event = installPrompt.value
  if (!event) return false
  event.prompt()
  const { outcome } = await event.userChoice
  installPrompt.value = null
  return outcome === 'accepted'
}
