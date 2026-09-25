import { ref } from 'vue'

// Route names per game mode: views shared by both modes (boosters,
// collection, binder) link within the mode they're showing.
export const MODE_ROUTES = {
  unlimited: {
    hub: 'game',
    boosters: 'boosters',
    collection: 'collection',
    binder: 'binder',
    history: 'history',
    achievements: 'achievements',
  },
  challenge: {
    hub: 'challenge',
    boosters: 'challenge-boosters',
    collection: 'challenge-collection',
    binder: 'challenge-binder',
    history: 'challenge-history',
    achievements: 'challenge-achievements',
  },
}

export const modeRoutes = (mode) => MODE_ROUTES[mode] ?? MODE_ROUTES.unlimited

// Community and profiles belong to both modes (route meta.sharedMode): they
// keep the mode the player came from, so the challenge doesn't vanish on the
// way. Remembered per tab, so a reload on /community stays in the challenge.
const STORAGE_KEY = 'pb-mode'

function readMode() {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === 'challenge' ? 'challenge' : 'unlimited'
  } catch {
    return 'unlimited'
  }
}

const lastMode = ref(readMode())

/** router.afterEach hook: every page with a mode of its own sets the current one. */
export function trackMode(to) {
  if (to.meta.sharedMode) return
  lastMode.value = to.meta.mode ?? 'unlimited'
  try {
    sessionStorage.setItem(STORAGE_KEY, lastMode.value)
  } catch {
    // private mode: the mode just won't survive a reload
  }
}

/** Mode a route is shown in: its own, or the one the player came from. */
export const routeMode = (route) => route.meta.mode ?? (route.meta.sharedMode ? lastMode.value : 'unlimited')
