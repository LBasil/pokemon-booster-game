import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

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
      meta: { requiresAuth: true },
    },
    {
      path: '/community',
      name: 'community',
      component: () => import('@/views/CommunityView.vue'),
      meta: { requiresAuth: true },
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
      // Public profile: shareable, readable even when signed out
      path: '/u/:username',
      name: 'public-profile',
      component: () => import('@/views/ProfileView.vue'),
      props: true,
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

router.beforeEach(async (to) => {
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

export default router
