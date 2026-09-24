<script setup>
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import BoosterArt from '@/components/BoosterArt.vue'
import BrandLogo from '@/components/BrandLogo.vue'

const { t } = useI18n()
const auth = useAuthStore()
</script>

<template>
  <div class="not-found container">
    <RouterLink :to="{ name: auth.isLoggedIn ? 'game' : 'home' }" class="not-found-brand">
      <BrandLogo />
    </RouterLink>

    <main class="not-found-main">
      <BoosterArt class="not-found-art" />
      <p class="pb-eyebrow">404</p>
      <h1 class="not-found-title">{{ t('notFound.title') }}</h1>
      <p class="pb-muted">{{ t('notFound.desc') }}</p>
      <RouterLink :to="{ name: auth.isLoggedIn ? 'game' : 'home' }" class="btn btn-primary btn-lg glow-button">
        {{ t('notFound.backHome') }}
      </RouterLink>
    </main>
  </div>
</template>

<style scoped>
.not-found {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  padding-top: 1.25rem;
  padding-bottom: 2rem;
}

.not-found-brand {
  align-self: flex-start;
}

.not-found-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  text-align: center;
  animation: pb-rise 0.6s var(--pb-ease-out) both;
}

.not-found-art {
  --booster-w: 120px;
  margin-bottom: 1rem;
  transform: rotate(-8deg);
  opacity: 0.85;
}

.not-found-title {
  margin: 0;
  font-size: clamp(1.8rem, 5vw, 2.6rem);
  font-weight: 800;
}

.not-found-main .pb-muted {
  max-width: 28rem;
  margin: 0 0 1rem;
}
</style>
