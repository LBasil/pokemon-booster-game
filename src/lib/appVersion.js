import { entryScriptOf, isNewBuild } from '@/utils/appVersion'

// Tabs left open (a phone in a pocket) keep running the build they loaded,
// so a deploy's new features stay invisible until a manual reload. This
// asks the server for index.html when the app comes back to the foreground
// (and now and then) and, once a new build is live, the router turns the
// next page change into a full load (router/index.js): nothing interrupts
// the player mid-page. Production builds only (dev has no hashed entry).
const CHECK_EVERY = 30 * 60 * 1000
const MIN_GAP = 5 * 60 * 1000

let running = null
let lastCheck = 0
let updateReady = false

/** A newer build is live: the next navigation should load it. */
export const hasUpdate = () => updateReady

async function check() {
  if (updateReady || Date.now() - lastCheck < MIN_GAP) return
  lastCheck = Date.now()
  try {
    const response = await fetch('/', { cache: 'no-store' })
    if (response.ok && isNewBuild(running, entryScriptOf(await response.text()))) {
      updateReady = true
      window.dispatchEvent(new Event('pb:update-ready'))
    }
  } catch {
    // offline: try again later
  }
}

export function watchAppVersion() {
  running = document.querySelector('script[type="module"][src*="/assets/index-"]')?.getAttribute('src') ?? null
  if (!running) return
  lastCheck = Date.now() // just loaded: it is the latest
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check()
  })
  setInterval(check, CHECK_EVERY)
}
