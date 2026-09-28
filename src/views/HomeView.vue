<script setup>
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { fetchPoolStats } from '@/api/sets'
import { isSupabaseConfigured } from '@/lib/supabaseClient'
import AuthPanel from '@/components/AuthPanel.vue'
import BrandLogo from '@/components/BrandLogo.vue'
import HeroCardFan from '@/components/HeroCardFan.vue'
import LanguageSwitcher from '@/components/LanguageSwitcher.vue'
import ThemeToggle from '@/components/ThemeToggle.vue'

const { t, locale } = useI18n()

// Live pool size under the tagline; purely decorative, so failures just hide it
const stats = ref(null)

onMounted(async () => {
  if (!isSupabaseConfigured) return
  try {
    stats.value = await fetchPoolStats()
  } catch {
    stats.value = null
  }
})

const formatNumber = (value) => value.toLocaleString(locale.value)
</script>

<template>
  <div class="home">
    <header class="home-topbar container">
      <BrandLogo />
      <div class="d-flex align-items-center gap-2">
        <LanguageSwitcher />
        <ThemeToggle />
      </div>
    </header>

    <main class="home-main container">
      <div class="home-copy">
        <h1 class="home-title">{{ t('home.title') }}</h1>

        <p class="home-tagline">{{ t('home.tagline') }}</p>

        <p v-if="stats" class="home-pool">
          {{ t('home.poolSize', { sets: formatNumber(stats.sets), cards: formatNumber(stats.cards) }) }}
        </p>
      </div>

      <!-- Cards fan out of the top of the login panel, like a freshly opened booster -->
      <div class="home-stage">
        <HeroCardFan class="home-fan" />
        <AuthPanel class="home-auth" />
      </div>
    </main>

    <footer class="home-footer container">
      {{ t('home.disclaimer') }}
    </footer>
  </div>
</template>

<style scoped>
.home {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow-x: clip;
}

.home-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding-top: 1.25rem;
  padding-bottom: 1.25rem;
}

/* Mobile: pitch, then the card/login stage. Desktop: pitch | stage */
.home-main {
  flex: 1;
  display: grid;
  gap: 1.5rem;
  align-items: center;
  padding-top: 1rem;
  padding-bottom: 2.5rem;
}

.home-copy {
  animation: pb-rise 0.7s var(--pb-ease-out) both;
}

.home-stage {
  --fan-card-w: min(31vw, 170px);
  /* How far the panel slides up over the bottom of the cards */
  --overlap: calc(var(--fan-card-w) * 88 / 63 * 0.5);
  display: flex;
  flex-direction: column;
  align-items: center;
}

.home-auth {
  position: relative;
  z-index: 30;
  margin-top: calc(-1 * var(--overlap));
  /* Near-opaque so the cards tucked behind never hurt legibility */
  background: color-mix(in srgb, var(--pb-bg-elevated) 94%, transparent);
  animation: pb-rise 0.7s 0.15s var(--pb-ease-out) both;
}

/* Holo foil edge along the top, like the torn-open lip of a booster */
.home-auth::before {
  content: '';
  position: absolute;
  top: -1px;
  left: 12%;
  right: 12%;
  height: 2px;
  border-radius: 2px;
  background: var(--pb-holo);
  box-shadow: 0 0 18px 2px color-mix(in srgb, #a78bfa 45%, transparent);
}

.home-title {
  max-width: 16em;
  margin: 0 0 1rem;
  font-size: clamp(1.9rem, 4.2vw, 2.9rem);
  font-weight: 800;
}

.home-tagline {
  max-width: 34rem;
  margin: 0;
  font-size: clamp(1rem, 2.5vw, 1.15rem);
  line-height: 1.6;
  color: var(--pb-text-muted);
}

.home-pool {
  margin: 1rem 0 0;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--pb-text-muted);
}

.home-footer {
  padding-top: 1rem;
  padding-bottom: 1.5rem;
  font-size: 0.75rem;
  color: var(--pb-text-muted);
  text-align: center;
}

@media (min-width: 992px) {
  .home-main {
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
    column-gap: 4rem;
  }

  .home-stage {
    --fan-card-w: clamp(150px, 13vw, 200px);
  }
}
</style>
