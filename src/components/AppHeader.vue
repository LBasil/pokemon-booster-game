<script setup>
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import BrandLogo from '@/components/BrandLogo.vue'
import LanguageSwitcher from '@/components/LanguageSwitcher.vue'
import ThemeToggle from '@/components/ThemeToggle.vue'

// Shared top bar for every signed-in view
const { t } = useI18n()
const router = useRouter()
const auth = useAuthStore()

const NAV = [
  { name: 'boosters', label: 'nav.boosters' },
  { name: 'collection', label: 'nav.collection' },
  { name: 'community', label: 'nav.community' },
  { name: 'profile', label: 'nav.profile' },
]

// Phone tab bar: same destinations plus the hub, each with an icon (SVG paths)
const TABS = [
  { name: 'game', label: 'nav.hub', icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
  { name: 'boosters', label: 'nav.boosters', icon: 'M7 3h10l1 3-1 15H7L6 6zM6 6h12M12 10l1.2 2.8L16 14l-2.8 1.2L12 18l-1.2-2.8L8 14l2.8-1.2z' },
  { name: 'collection', label: 'nav.collection', icon: 'M8 3h11v15H8zM5 6v15h11' },
  { name: 'community', label: 'nav.community', icon: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M18 14a6 6 0 0 1 4 7' },
  { name: 'profile', label: 'nav.profile', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0' },
]

async function logout() {
  await auth.signOut()
  router.push({ name: 'home' })
}
</script>

<template>
  <header class="app-header container">
    <RouterLink :to="{ name: 'game' }" class="app-header-brand" :aria-label="t('nav.hub')">
      <BrandLogo />
    </RouterLink>

    <nav class="app-header-nav" :aria-label="t('nav.main')">
      <RouterLink v-for="item in NAV" :key="item.name" :to="{ name: item.name }">
        {{ t(item.label) }}
      </RouterLink>
    </nav>

    <div class="app-header-actions">
      <LanguageSwitcher />
      <ThemeToggle />
      <button
        type="button"
        class="icon-button"
        :aria-label="t('common.logout')"
        :title="t('common.logout')"
        @click="logout"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3" />
        </svg>
      </button>
    </div>

    <nav class="app-tabbar" :aria-label="t('nav.main')">
      <RouterLink v-for="tab in TABS" :key="tab.name" :to="{ name: tab.name }">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="tab.icon" /></svg>
        <span>{{ t(tab.label) }}</span>
      </RouterLink>
    </nav>
  </header>
</template>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding-top: 1.25rem;
  padding-bottom: 1.25rem;
}

.app-header-brand {
  flex-shrink: 0;
}

.app-header-nav {
  display: none;
  gap: 0.25rem;
  margin: 0 auto;
  padding: 4px;
  border-radius: 999px;
  border: 1px solid var(--pb-border);
  background: var(--pb-surface);
  backdrop-filter: blur(12px);
}

.app-header-nav a {
  padding: 0.45rem 1rem;
  border-radius: 999px;
  color: var(--pb-text-muted);
  font-weight: 600;
  font-size: 0.9rem;
  transition:
    color 0.2s,
    background-color 0.2s;
}

.app-header-nav a:hover {
  color: var(--pb-text);
}

.app-header-nav a.router-link-active {
  color: var(--pb-text);
  background: var(--pb-selected);
}

.app-header-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: auto;
}

.icon-button {
  display: inline-grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  border: 1px solid var(--pb-border-strong);
  background: var(--pb-surface);
  color: var(--pb-text);
  backdrop-filter: blur(12px);
  transition: background-color 0.2s;
}

.icon-button:hover {
  background: var(--pb-surface-hover);
}

.icon-button svg {
  width: 19px;
  height: 19px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* Fixed bottom tab bar on phones; pages add .pb-page to leave room for it */
.app-tabbar {
  position: fixed;
  left: 12px;
  right: 12px;
  bottom: calc(12px + env(safe-area-inset-bottom));
  z-index: 50;
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  padding: 6px;
  border-radius: var(--pb-radius-lg);
  border: 1px solid var(--pb-border-strong);
  background: color-mix(in srgb, var(--pb-bg-elevated) 92%, transparent);
  backdrop-filter: blur(16px);
  box-shadow: var(--pb-shadow-lg);
}

.app-tabbar a {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 6px 2px;
  border-radius: var(--pb-radius-md);
  color: var(--pb-text-muted);
  font-size: 0.66rem;
  font-weight: 700;
  min-width: 0;
}

.app-tabbar span {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-tabbar a.router-link-exact-active {
  color: var(--pb-text);
  background: var(--pb-selected);
}

.app-tabbar svg {
  width: 22px;
  height: 22px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.app-tabbar a.router-link-exact-active svg {
  stroke: var(--pb-text);
}

/* Brand name is dropped on small phones so the controls fit */
@media (max-width: 400px) {
  .app-header-brand :deep(.brand-name) {
    display: none;
  }
}

@media (min-width: 768px) {
  .app-header-nav {
    display: flex;
  }

  .app-header-actions {
    margin-left: 0;
  }

  .app-tabbar {
    display: none;
  }
}
</style>
