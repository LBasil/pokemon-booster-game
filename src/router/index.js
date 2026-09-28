import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { trackMode } from './modes'
import { isChunkLoadError } from '@/utils/chunkError'
import { hasUpdate } from '@/lib/appVersion'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/views/HomeView.vue'),
    },
    {
      path: '/game',
      name: 'game',
      component: () => import('@/views/GameHubView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/boosters',
      name: 'boosters',
      component: () => import('@/views/BoosterView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/collection',
      name: 'collection',
      component: () => import('@/views/CollectionView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/collection/set/:setId',
      name: 'binder',
      component: () => import('@/views/SetBinderView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/history',
      name: 'history',
      component: () => import('@/views/HistoryView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/profile',
      name: 'profile',
      component: () => import('@/views/ProfileView.vue'),
      meta: { requiresAuth: true, sharedMode: true },
    },
    {
      path: '/achievements',
      name: 'achievements',
      component: () => import('@/views/AchievementsView.vue'),
      meta: { requiresAuth: true },
    },
    {
      path: '/community',
      name: 'community',
      component: () => import('@/views/CommunityView.vue'),
      meta: { requiresAuth: true, sharedMode: true },
    },
    {
      // Challenge mode: its own collection and coin economy (migration 0005)
      path: '/challenge',
      name: 'challenge',
      component: () => import('@/views/ChallengeView.vue'),
      meta: { requiresAuth: true, mode: 'challenge' },
    },
    {
      path: '/challenge/boosters',
      name: 'challenge-boosters',
      component: () => import('@/views/BoosterView.vue'),
      props: { mode: 'challenge' },
      meta: { requiresAuth: true, mode: 'challenge' },
    },
    {
      path: '/challenge/collection',
      name: 'challenge-collection',
      component: () => import('@/views/CollectionView.vue'),
      props: { mode: 'challenge' },
      meta: { requiresAuth: true, mode: 'challenge' },
    },
    {
      path: '/challenge/collection/set/:setId',
      name: 'challenge-binder',
      component: () => import('@/views/SetBinderView.vue'),
      props: { mode: 'challenge' },
      meta: { requiresAuth: true, mode: 'challenge' },
    },
    {
      path: '/challenge/history',
      name: 'challenge-history',
      component: () => import('@/views/HistoryView.vue'),
      props: { mode: 'challenge' },
      meta: { requiresAuth: true, mode: 'challenge' },
    },
    {
      path: '/challenge/achievements',
      name: 'challenge-achievements',
      component: () => import('@/views/AchievementsView.vue'),
      props: { mode: 'challenge' },
      meta: { requiresAuth: true, mode: 'challenge' },
    },
    {
      // Mini-games: coins for the challenge (every game in src/utils/games.js)
      path: '/challenge/games',
      name: 'challenge-games',
      component: () => import('@/views/GamesView.vue'),
      meta: { requiresAuth: true, mode: 'challenge' },
    },
    {
      // "Higher or lower" (migration 0013)
      path: '/challenge/games/higher-lower',
      name: 'challenge-game-higher-lower',
      component: () => import('@/views/MinigameView.vue'),
      meta: { requiresAuth: true, mode: 'challenge' },
    },
    { path: '/challenge/minigame', redirect: { name: 'challenge-game-higher-lower' } },
    {
      // "Shiny Electrode Flip" (migration 0014)
      path: '/challenge/games/electrode-flip',
      name: 'challenge-game-electrode-flip',
      component: () => import('@/views/ElectrodeFlipView.vue'),
      meta: { requiresAuth: true, mode: 'challenge' },
    },
    {
      // "Super effective!" (migration 0015)
      path: '/challenge/games/super-effective',
      name: 'challenge-game-super-effective',
      component: () => import('@/views/SuperEffectiveView.vue'),
      meta: { requiresAuth: true, mode: 'challenge' },
    },
    {
      path: '/challenge/trades',
      name: 'challenge-trades',
      component: () => import('@/views/TradesView.vue'),
      meta: { requiresAuth: true, mode: 'challenge' },
    },
    {
      // Public profile: shareable, readable even when signed out
      path: '/u/:username',
      name: 'public-profile',
      component: () => import('@/views/ProfileView.vue'),
      props: true,
      meta: { sharedMode: true },
    },
    {
      path: '/u/:username/achievements',
      name: 'public-achievements',
      component: () => import('@/views/AchievementsView.vue'),
      props: true,
      meta: { sharedMode: true },
    },
    {
      // "Forgot password" email link lands here (recovery session in the URL)
      path: '/reset-password',
      name: 'reset-password',
      component: () => import('@/views/ResetPasswordView.vue'),
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('@/views/NotFoundView.vue'),
    },
  ],
})

router.beforeEach(async (to, from) => {
  // A new deploy is live (lib/appVersion.js): load it with this page change
  // (a real one: filters rewrite the query string as the player types)
  if (hasUpdate() && from.name && to.path !== from.path) {
    window.location.assign(to.fullPath)
    return false
  }

  const auth = useAuthStore()
  if (!auth.ready) await auth.init()

  if (to.meta.requiresAuth && !auth.isLoggedIn) {
    return { name: 'home' }
  }
  if (to.name === 'home' && auth.isLoggedIn) {
    return { name: 'game' }
  }
  return true
})

router.afterEach(trackMode)

// A new deploy while the app is open: the old build's lazy chunks are gone,
// so load the page the player asked for from scratch (once, not in a loop
// if the chunk is really unreachable, e.g. offline)
const CHUNK_RELOAD_KEY = 'pb-chunk-reload'
router.onError((error, to) => {
  if (!isChunkLoadError(error)) return
  try {
    if (Date.now() - Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) ?? 0) < 10_000) return
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()))
  } catch {
    // no storage: still worth one reload
  }
  window.location.assign(to?.fullPath ?? window.location.href)
})

export default router
