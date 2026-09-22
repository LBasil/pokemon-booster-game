<script setup>
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import ThemeToggle from '@/components/ThemeToggle.vue'

const { t } = useI18n()
const router = useRouter()
const auth = useAuthStore()

async function logout() {
  await auth.signOut()
  router.push({ name: 'home' })
}
</script>

<template>
  <div class="container text-center py-5">
    <ThemeToggle />

    <h1 class="mb-2 game-title">{{ t('game.title') }}</h1>
    <p class="mb-5">{{ t('game.greeting', { name: auth.displayName }) }}</p>

    <div class="row justify-content-center g-4">
      <div class="col-12 col-md-4">
        <RouterLink :to="{ name: 'boosters' }" class="card game-card h-100 text-decoration-none">
          <div class="card-body">
            <h5 class="card-title">{{ t('game.openBoosters') }}</h5>
            <p class="card-text text-body-secondary">{{ t('game.openBoostersDesc') }}</p>
          </div>
        </RouterLink>
      </div>
      <div class="col-12 col-md-4">
        <RouterLink :to="{ name: 'collection' }" class="card game-card h-100 text-decoration-none">
          <div class="card-body">
            <h5 class="card-title">{{ t('game.viewCollection') }}</h5>
            <p class="card-text text-body-secondary">{{ t('game.viewCollectionDesc') }}</p>
          </div>
        </RouterLink>
      </div>
      <div class="col-12 col-md-4">
        <RouterLink :to="{ name: 'profile' }" class="card game-card h-100 text-decoration-none">
          <div class="card-body">
            <h5 class="card-title">{{ t('game.profile') }}</h5>
            <p class="card-text text-body-secondary">{{ t('game.profileDesc') }}</p>
          </div>
        </RouterLink>
      </div>
    </div>

    <button type="button" class="btn btn-outline-secondary mt-5" @click="logout">
      {{ t('common.logout') }}
    </button>
  </div>
</template>
