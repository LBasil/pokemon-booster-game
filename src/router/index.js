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
      path: '/profile',
      name: 'profile',
      component: () => import('@/views/ProfileView.vue'),
      meta: { requiresAuth: true },
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
