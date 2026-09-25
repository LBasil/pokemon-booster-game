<script setup>
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useChallengeStore } from '@/stores/challenge'
import BrandLogo from '@/components/BrandLogo.vue'
import CoinAmount from '@/components/CoinAmount.vue'
import LanguageSwitcher from '@/components/LanguageSwitcher.vue'
import ThemeToggle from '@/components/ThemeToggle.vue'

// Shared top bar for every signed-in view. Inside the challenge mode
// (route meta.mode), Boosters / Collection lead to the challenge versions.
const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const inChallenge = computed(() => route.meta.mode === 'challenge')

// Rewards to claim + trade offers to answer, shown on the Challenge links
const challenge = useChallengeStore()
onMounted(() => {
  if (auth.isLoggedIn) challenge.loadBadge()
})
const badges = computed(() => ({
  challenge: challenge.badge.rewards + (inChallenge.value ? 0 : challenge.badge.trades),
  'challenge-trades': challenge.badge.trades,
}))
// The tab bar has no Trades tab: everything shows on Challenge, or on Home
// (which holds the challenge tile) outside the challenge
const tabBadge = (name) => {
  const total = challenge.badge.rewards + challenge.badge.trades
  return name === 'challenge' || (name === 'game' && !inChallenge.value) ? total : 0
}

const ICONS = {
  hub: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  boosters: 'M7 3h10l1 3-1 15H7L6 6zM6 6h12M12 10l1.2 2.8L16 14l-2.8 1.2L12 18l-1.2-2.8L8 14l2.8-1.2z',
  collection: 'M8 3h11v15H8zM5 6v15h11',
  community: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M18 14a6 6 0 0 1 4 7',
  profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  challenge: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 21h8M9 17h6',
}

const NAV = computed(() =>
  inChallenge.value
    ? [
        { name: 'challenge', label: 'nav.challenge' },
        { name: 'challenge-boosters', label: 'nav.boosters' },
        { name: 'challenge-collection', label: 'nav.collection' },
        { name: 'challenge-trades', label: 'nav.trades' },
        { name: 'community', label: 'nav.community' },
        { name: 'profile', label: 'nav.profile' },
      ]
    : [
        { name: 'boosters', label: 'nav.boosters' },
        { name: 'collection', label: 'nav.collection' },
        { name: 'challenge', label: 'nav.challenge' },
        { name: 'community', label: 'nav.community' },
        { name: 'profile', label: 'nav.profile' },
      ],
)

// Phone tab bar: 5 destinations with icons. The challenge swaps in its own
// hub, boosters and collection (Community stays one tap away on the hubs).
const TABS = computed(() =>
  inChallenge.value
    ? [
        { name: 'game', label: 'nav.hub', icon: ICONS.hub },
        { name: 'challenge', label: 'nav.challenge', icon: ICONS.challenge },
        { name: 'challenge-boosters', label: 'nav.boosters', icon: ICONS.boosters },
        { name: 'challenge-collection', label: 'nav.collection', icon: ICONS.collection },
        { name: 'profile', label: 'nav.profile', icon: ICONS.profile },
      ]
    : [
        { name: 'game', label: 'nav.hub', icon: ICONS.hub },
        { name: 'boosters', label: 'nav.boosters', icon: ICONS.boosters },
        { name: 'collection', label: 'nav.collection', icon: ICONS.collection },
        { name: 'community', label: 'nav.community', icon: ICONS.community },
        { name: 'profile', label: 'nav.profile', icon: ICONS.profile },
      ],
)

// Pages without their own link light up their parent: binders their
// collection, histories the profile / challenge. The tab bar has no Trades
// tab, so trades count as the challenge there.
const PARENTS = {
  binder: 'collection',
  'challenge-binder': 'challenge-collection',
  history: 'profile',
  'challenge-history': 'challenge',
}
const isActive = (name, inTabBar = false) =>
  route.name === name ||
  PARENTS[route.name] === name ||
  (inTabBar && name === 'challenge' && route.name === 'challenge-trades')

async function logout() {
  await auth.signOut()
  router.push({ name: 'home' })
}
</script>

<template>
  <header class="app-header container" :class="{ 'is-challenge': inChallenge }">
    <RouterLink :to="{ name: 'game' }" class="app-header-brand" :aria-label="t('nav.hub')">
      <BrandLogo />
    </RouterLink>

    <nav class="app-header-nav" :aria-label="t('nav.main')">
      <RouterLink
        v-for="item in NAV"
        :key="item.name"
        :to="{ name: item.name }"
        :class="{ active: isActive(item.name) }"
        :aria-current="isActive(item.name) ? 'page' : undefined"
      >
        {{ t(item.label) }}
        <span v-if="badges[item.name]" class="nav-badge">
          {{ badges[item.name] }}<span class="visually-hidden"> {{ t('nav.pending', badges[item.name]) }}</span>
        </span>
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
      <RouterLink
        v-for="tab in TABS"
        :key="tab.name"
        :to="{ name: tab.name }"
        :class="{ active: isActive(tab.name, true) }"
        :aria-current="isActive(tab.name, true) ? 'page' : undefined"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="tab.icon" /></svg>
        <span>{{ t(tab.label) }}</span>
        <span v-if="tabBadge(tab.name)" class="tab-badge">
          {{ tabBadge(tab.name) }}<span class="visually-hidden"> {{ t('nav.pending', tabBadge(tab.name)) }}</span>
        </span>
      </RouterLink>
    </nav>

    <!-- Every challenge page says so, with the way out (phones included) -->
    <div v-if="inChallenge" class="mode-strip">
      <RouterLink :to="{ name: 'challenge' }" class="mode-strip-name">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="ICONS.challenge" /></svg>
        {{ t('nav.challengeMode') }}
      </RouterLink>
      <CoinAmount v-if="challenge.state" class="mode-strip-coins" :amount="challenge.coins" />
      <RouterLink :to="{ name: 'game' }" class="mode-strip-leave">
        {{ t('nav.leaveChallenge') }} <span aria-hidden="true">→</span>
      </RouterLink>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  display: flex;
  flex-wrap: wrap;
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
  display: inline-flex;
  align-items: center;
  white-space: nowrap;
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

.app-header-nav a.active {
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

/* Count of rewards / trade offers waiting */
.nav-badge,
.tab-badge {
  display: inline-grid;
  place-items: center;
  min-width: 1.15rem;
  height: 1.15rem;
  padding: 0 0.3rem;
  border-radius: 999px;
  background: var(--pb-accent);
  color: var(--pb-accent-ink);
  font-size: 0.68rem;
  font-weight: 800;
  line-height: 1;
}

.nav-badge {
  margin-left: 0.35rem;
}

/* Small desktops: the challenge's 6 links need the brand's room */
@media (min-width: 992px) and (max-width: 1199.98px) {
  .is-challenge .app-header-brand :deep(.brand-name) {
    display: none;
  }

  .is-challenge .app-header-nav a {
    padding: 0.45rem 0.8rem;
  }
}

.app-tabbar a {
  position: relative;
}

.tab-badge {
  position: absolute;
  top: 2px;
  left: calc(50% + 6px);
}

/* Challenge strip: full-width row under the header */
.mode-strip {
  order: 10;
  flex-basis: 100%;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.45rem 0.6rem 0.45rem 0.9rem;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--pb-accent) 45%, transparent);
  background: color-mix(in srgb, var(--pb-accent) 14%, var(--pb-bg-elevated));
  font-size: 0.85rem;
  font-weight: 700;
}

.mode-strip-name {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--pb-text);
  font-family: var(--pb-font-display);
  font-size: 0.8rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.mode-strip-name svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: var(--pb-coin);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.mode-strip-coins {
  color: var(--pb-coin);
  font-weight: 800;
}

.mode-strip-leave {
  margin-left: auto;
  padding: 0.25rem 0.75rem;
  border-radius: 999px;
  background: var(--pb-surface);
  color: var(--pb-text);
  white-space: nowrap;
}

.mode-strip-leave:hover {
  color: var(--pb-text);
  background: var(--pb-surface-hover);
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

.app-tabbar a.active {
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

.app-tabbar a.active svg {
  stroke: var(--pb-text);
}

/* Brand name is dropped on small phones so the controls fit */
@media (max-width: 400px) {
  .app-header-brand :deep(.brand-name) {
    display: none;
  }
}

/* Desktop nav from 992px (6 links in the challenge); tab bar below */
@media (min-width: 992px) {
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
