<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { routeMode } from '@/router/modes'
import { useAuthStore } from '@/stores/auth'
import { useAchievementText } from '@/composables/useAchievementText'
import { useModeAchievements } from '@/composables/useModeAchievements'
import { CATEGORIES, STATUSES, filterAchievements } from '@/utils/achievements'
import AchievementTile from '@/components/AchievementTile.vue'
import AppHeader from '@/components/AppHeader.vue'
import ScrollTopButton from '@/components/ScrollTopButton.vue'
import BrandLogo from '@/components/BrandLogo.vue'

// Every achievement of one game mode, by category, with search +
// category/status filters (synced to the URL) and an Unlimited | Challenge
// switch. Serves /achievements and /challenge/achievements (own, `mode`
// prop) and /u/:username/achievements (public, works signed out; mode in
// ?mode=, else the mode the viewer came from).
const props = defineProps({
  mode: { type: String, default: 'unlimited' },
  username: { type: String, default: '' },
})

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const text = useAchievementText()

const isOwn = computed(() => !props.username)
const MODES = ['challenge', 'unlimited'] // the challenge first: it's the one that counts
const mode = computed(() => {
  if (isOwn.value) return props.mode
  return MODES.includes(route.query.mode) ? route.query.mode : routeMode(route)
})

const { list, progress, rate, hasRates, firstLoad, failed, missing, publicName } = useModeAchievements(mode, () => props.username)
const percent = (part, total) => Math.round((part / (total || 1)) * 100)

// ---------- Filters (URL-synced: ?cat=&status=&q=) ----------

const category = ref('all')
const status = ref('all')
const query = ref('')

let syncingFromRoute = false
function readQuery(q) {
  syncingFromRoute = true
  category.value = CATEGORIES.includes(q.cat) ? q.cat : 'all'
  status.value = STATUSES.includes(q.status) ? q.status : 'all'
  query.value = typeof q.q === 'string' ? q.q : ''
  nextTick(() => (syncingFromRoute = false))
}
readQuery(route.query)
watch(() => route.query, readQuery)

watch([category, status, query], () => {
  if (syncingFromRoute) return
  router.replace({
    query: {
      ...(route.query.mode && { mode: route.query.mode }),
      ...(category.value !== 'all' && { cat: category.value }),
      ...(status.value !== 'all' && { status: status.value }),
      ...(query.value && { q: query.value }),
    },
  })
})

const isFiltered = computed(() => category.value !== 'all' || status.value !== 'all' || query.value)
function resetFilters() {
  category.value = 'all'
  status.value = 'all'
  query.value = ''
}

const pickCategory = (name) => (category.value = category.value === name ? 'all' : name)

const results = computed(() =>
  filterAchievements(list.value, { category: category.value, status: status.value, query: query.value }, (item) => `${text.title(item)} ${text.desc(item)}`),
)

// Results grouped by category, in category order
const groups = computed(() =>
  progress.value.categories
    .map((summary) => ({ ...summary, items: results.value.filter((item) => item.category === summary.category) }))
    .filter((group) => group.items.length),
)

// ---------- Collapsible categories (remembered on this device) ----------

const COLLAPSED_KEY = 'pb-achievements-collapsed'
function readCollapsed() {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY)) ?? [])
  } catch {
    return new Set()
  }
}
const collapsed = ref(readCollapsed())
function saveCollapsed() {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed.value]))
  } catch {
    // private mode: kept for this visit only
  }
}
// A search or a picked category opens what it found, so nothing is hidden
const isOpen = (name) => Boolean(query.value) || category.value === name || !collapsed.value.has(name)
function toggleGroup(name) {
  const next = new Set(collapsed.value)
  if (isOpen(name)) next.add(name)
  else next.delete(name)
  collapsed.value = next
  saveCollapsed()
}
const allCollapsed = computed(() => groups.value.every((group) => !isOpen(group.category)))
function toggleAll() {
  collapsed.value = allCollapsed.value ? new Set() : new Set(progress.value.categories.map((summary) => summary.category))
  saveCollapsed()
}

// Same filters in the other mode
const filterQuery = computed(() => {
  const { mode: _mode, ...rest } = route.query
  return rest
})
const modeLink = (target) =>
  isOwn.value
    ? { name: target === 'challenge' ? 'challenge-achievements' : 'achievements', query: filterQuery.value }
    : { name: 'public-achievements', params: { username: props.username }, query: { ...filterQuery.value, mode: target } }

const title = computed(() => {
  if (!isOwn.value) return t('achievements.ui.publicTitle', { name: publicName.value || props.username })
  return mode.value === 'challenge' ? t('achievements.ui.titleChallenge') : t('achievements.ui.titleUnlimited')
})
const back = computed(() => {
  if (!isOwn.value) return { to: { name: 'public-profile', params: { username: props.username } }, label: t('achievements.ui.backToProfile') }
  return mode.value === 'challenge'
    ? { to: { name: 'challenge' }, label: t('challenge.backToHub') }
    : { to: { name: 'profile' }, label: t('achievements.ui.backToProfile') }
})
</script>

<template>
  <div class="pb-page">
    <AppHeader v-if="auth.isLoggedIn" />
    <header v-else class="container public-header">
      <RouterLink :to="{ name: 'home' }"><BrandLogo /></RouterLink>
      <RouterLink :to="{ name: 'home' }" class="btn btn-primary glow-button">{{ t('profile.join') }}</RouterLink>
    </header>

    <main class="container ach">
      <header class="ach-head">
        <RouterLink :to="back.to" class="ach-back">
          <span aria-hidden="true">←</span> {{ back.label }}
        </RouterLink>
        <nav class="ach-modes" :aria-label="t('nav.modeSwitch')">
          <RouterLink
            v-for="item in MODES"
            :key="item"
            :to="modeLink(item)"
            :class="{ active: mode === item }"
            :aria-current="mode === item ? 'page' : undefined"
          >
            {{ t(item === 'challenge' ? 'nav.modeChallenge' : 'nav.modeUnlimited') }}
          </RouterLink>
        </nav>
        <h1 class="ach-title">{{ title }}</h1>
        <p class="ach-mode-hint">{{ t(mode === 'challenge' ? 'achievements.ui.challengeHint' : 'achievements.ui.unlimitedHint') }}</p>
      </header>

      <div v-if="missing" class="alert alert-danger" role="alert">{{ t('profile.notFound', { name: username }) }}</div>
      <div v-else-if="failed" class="alert alert-danger" role="alert">{{ t('achievements.ui.loadError') }}</div>

      <template v-else-if="firstLoad">
        <div class="pb-skeleton" style="height: 150px"></div>
        <div class="ach-cats mt-3">
          <div v-for="n in 6" :key="n" class="pb-skeleton" style="height: 74px"></div>
        </div>
      </template>

      <template v-else>
        <!-- ============ Overall progress ============ -->
        <section class="ach-overview" :aria-label="t('achievements.ui.overall')">
          <div class="ach-overview-numbers">
            <span class="ach-overview-count">
              <span class="pb-holo-text">{{ text.number(progress.unlocked) }}</span>
              <span class="ach-overview-total">/ {{ text.number(progress.total) }}</span>
            </span>
            <span class="ach-overview-percent">{{ percent(progress.unlocked, progress.total) }}%</span>
          </div>
          <div
            class="ach-bar ach-bar-lg"
            role="progressbar"
            :aria-label="t('achievements.ui.overall')"
            aria-valuemin="0"
            :aria-valuemax="progress.total"
            :aria-valuenow="progress.unlocked"
            :aria-valuetext="t('achievements.ui.unlockedOf', { unlocked: progress.unlocked, total: progress.total })"
          >
            <span :style="{ width: `${percent(progress.unlocked, progress.total)}%` }"></span>
          </div>
          <p class="ach-note">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2z" /></svg>
            <span>
              {{ t('achievements.ui.moreComing') }}
              <template v-if="hasRates">{{ t('achievements.ui.rateNote') }}</template>
            </span>
          </p>
        </section>

        <!-- ============ Categories (also the category filter) ============ -->
        <div class="ach-cats" role="group" :aria-label="t('achievements.ui.categoriesLabel')">
          <button
            v-for="summary in progress.categories"
            :key="summary.category"
            type="button"
            class="ach-cat"
            :class="{ active: category === summary.category, done: summary.unlocked === summary.total }"
            :aria-pressed="category === summary.category"
            @click="pickCategory(summary.category)"
          >
            <span class="ach-cat-name">{{ t(`achievements.categories.${summary.category}`) }}</span>
            <span class="ach-cat-count">{{ summary.unlocked }} / {{ summary.total }}</span>
            <span class="ach-bar" aria-hidden="true"><span :style="{ width: `${percent(summary.unlocked, summary.total)}%` }"></span></span>
          </button>
        </div>

        <!-- ============ Search + status ============ -->
        <div class="ach-toolbar">
          <div class="ach-search">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4" /></svg>
            <input
              v-model="query"
              type="search"
              class="form-control"
              :placeholder="t('achievements.ui.searchPlaceholder')"
              :aria-label="t('achievements.ui.searchLabel')"
            />
          </div>
          <div class="ach-status" role="group" :aria-label="t('achievements.ui.statusLabel')">
            <button
              v-for="option in STATUSES"
              :key="option"
              type="button"
              class="ach-chip"
              :class="{ active: status === option }"
              :aria-pressed="status === option"
              @click="status = option"
            >
              {{ t(`achievements.ui.status.${option}`) }}
            </button>
          </div>
        </div>

        <div class="ach-results-head">
          <p class="ach-results" role="status">{{ t('achievements.ui.results', { count: results.length }, results.length) }}</p>
          <span class="ach-results-actions">
            <button v-if="isFiltered" type="button" class="btn btn-link ach-clear" @click="resetFilters">{{ t('achievements.ui.clear') }}</button>
            <button v-if="groups.length > 1 && !query" type="button" class="btn btn-link ach-clear" @click="toggleAll">
              {{ allCollapsed ? t('achievements.ui.expandAll') : t('achievements.ui.collapseAll') }}
            </button>
          </span>
        </div>

        <p v-if="!results.length" class="ach-empty">{{ t('achievements.ui.empty') }}</p>

        <section v-for="group in groups" :key="group.category" class="ach-group" :class="{ closed: !isOpen(group.category) }" :aria-labelledby="`ach-${group.category}`">
          <h2 :id="`ach-${group.category}`" class="ach-group-title">
            <button
              type="button"
              class="ach-group-head"
              :aria-expanded="isOpen(group.category)"
              :aria-controls="`ach-list-${group.category}`"
              @click="toggleGroup(group.category)"
            >
              <span class="pb-section-title">{{ t(`achievements.categories.${group.category}`) }}</span>
              <span class="ach-group-count">{{ group.unlocked }} / {{ group.total }}</span>
              <span class="ach-bar ach-group-bar" aria-hidden="true"><span :style="{ width: `${percent(group.unlocked, group.total)}%` }"></span></span>
              <svg class="ach-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
            </button>
          </h2>
          <ul v-show="isOpen(group.category)" :id="`ach-list-${group.category}`" class="ach-grid" role="list">
            <AchievementTile v-for="item in group.items" :key="item.id" :item="item" :rate="rate(item)" />
          </ul>
        </section>
      </template>
    </main>
    <ScrollTopButton />
  </div>
</template>

<style scoped>
.ach {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.ach-back {
  display: block;
  width: fit-content;
  margin-bottom: 0.75rem;
  font-weight: 700;
  color: var(--pb-text-muted);
}

.ach-back:hover {
  color: var(--pb-text);
}

.ach-modes {
  display: flex;
  width: fit-content;
  gap: 4px;
  margin-bottom: 1rem;
  padding: 4px;
  border-radius: 999px;
  border: 1px solid var(--pb-border-strong);
  background: var(--pb-surface);
}

.ach-modes a {
  padding: 0.4rem 1rem;
  border-radius: 999px;
  color: var(--pb-text-muted);
  font-weight: 700;
  font-size: 0.85rem;
  white-space: nowrap;
}

@media (hover: hover) {
  .ach-modes a:hover {
    color: var(--pb-text);
  }
}

.ach-modes a.active {
  background: var(--pb-text);
  color: var(--pb-bg);
}

.ach-mode-hint {
  margin: 0.5rem 0 0;
  max-width: 60ch;
  color: var(--pb-text-muted);
}

.ach-title {
  margin: 0;
  font-size: clamp(1.8rem, 5vw, 2.6rem);
  font-weight: 800;
}

/* ---------- Overall ---------- */

.ach-overview {
  padding: 1.5rem;
  border-radius: var(--pb-radius-lg);
  border: 1px solid var(--pb-border);
  background: var(--pb-surface);
  animation: pb-rise 0.6s var(--pb-ease-out) both;
}

.ach-overview-numbers {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.ach-overview-count {
  font-family: var(--pb-font-display);
  font-size: clamp(2rem, 7vw, 3rem);
  font-weight: 800;
  line-height: 1;
}

.ach-overview-total {
  margin-left: 0.3rem;
  font-size: 0.45em;
  color: var(--pb-text-muted);
}

.ach-overview-percent {
  font-family: var(--pb-font-display);
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--pb-text-muted);
}

.ach-bar {
  display: block;
  height: 6px;
  border-radius: 999px;
  background: var(--pb-input-bg);
  border: 1px solid var(--pb-border);
  overflow: hidden;
}

.ach-bar > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--pb-holo);
  transition: width 0.8s var(--pb-ease-out);
}

.ach-bar-lg {
  height: 14px;
}

.ach-note {
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
  margin: 1rem 0 0;
  font-size: 0.85rem;
  color: var(--pb-text-muted);
}

.ach-note svg {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  margin-top: 0.1rem;
  fill: none;
  stroke: var(--pb-ring);
  stroke-width: 2;
  stroke-linejoin: round;
}

/* ---------- Categories ---------- */

.ach-cats {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 0.6rem;
}

.ach-cat {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.75rem 0.85rem;
  border-radius: var(--pb-radius-md);
  border: 1px solid var(--pb-border);
  background: var(--pb-surface);
  color: var(--pb-text);
  text-align: left;
  transition:
    border-color 0.2s,
    background-color 0.2s;
}

@media (hover: hover) {
  .ach-cat:hover {
    background: var(--pb-surface-hover);
  }
}

.ach-cat.active {
  border-color: var(--pb-ring);
  box-shadow: 0 0 0 1px var(--pb-ring);
}

.ach-cat-name {
  font-weight: 800;
  font-size: 0.85rem;
  line-height: 1.2;
}

.ach-cat-count {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--pb-text-muted);
}

.ach-cat.done .ach-cat-count {
  color: var(--pb-text);
}

/* Phones: one scrolling row instead of a tall grid */
@media (max-width: 575.98px) {
  .ach-cats {
    display: flex;
    margin: 0 calc(var(--bs-gutter-x) * -0.5);
    padding: 2px calc(var(--bs-gutter-x) * 0.5);
    overflow-x: auto;
    scrollbar-width: none;
  }

  .ach-cat {
    flex: 0 0 140px;
  }
}

/* ---------- Toolbar ---------- */

.ach-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
  align-items: center;
}

.ach-search {
  position: relative;
  flex: 1 1 260px;
}

.ach-search svg {
  position: absolute;
  top: 50%;
  left: 0.9rem;
  width: 18px;
  height: 18px;
  transform: translateY(-50%);
  fill: none;
  stroke: var(--pb-text-muted);
  stroke-width: 2;
  stroke-linecap: round;
  pointer-events: none;
}

.ach-search .form-control {
  padding-left: 2.6rem;
}

.ach-status {
  display: flex;
  gap: 0.4rem;
  overflow-x: auto;
  scrollbar-width: none;
}

.ach-chip {
  flex-shrink: 0;
  padding: 0.4rem 0.9rem;
  border-radius: 999px;
  border: 1px solid var(--pb-border-strong);
  background: var(--pb-surface);
  color: var(--pb-text-muted);
  font-size: 0.85rem;
  font-weight: 700;
  transition:
    background-color 0.2s,
    color 0.2s;
}

@media (hover: hover) {
  .ach-chip:hover {
    color: var(--pb-text);
  }
}

.ach-chip.active {
  background: var(--pb-text);
  border-color: var(--pb-text);
  color: var(--pb-bg);
}

.ach-results-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: -0.5rem;
}

.ach-results {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--pb-text-muted);
}

.ach-clear {
  padding: 0;
  font-weight: 700;
}

.ach-empty {
  padding: 2rem 0;
  text-align: center;
  color: var(--pb-text-muted);
}

/* ---------- Groups ---------- */

.ach-results-actions {
  display: flex;
  gap: 1rem;
}

.ach-group-title {
  margin: 0 0 0.75rem;
  font-size: inherit;
}

/* The whole header row toggles the category */
.ach-group-head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.35rem 0;
  border: none;
  background: none;
  color: var(--pb-text);
  text-align: left;
}

/* Same look as the other h2s (the text now sits in a button) */
.ach-group-head .pb-section-title {
  margin: 0;
  font-family: var(--pb-font-display);
  font-weight: 700;
}

.ach-group-count {
  margin-left: auto;
  font-weight: 700;
  color: var(--pb-text-muted);
  white-space: nowrap;
}

/* Progress at a glance, mostly useful once collapsed */
.ach-group-bar {
  flex: 0 0 72px;
}

.ach-chevron {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  fill: none;
  stroke: var(--pb-text-muted);
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: transform 0.2s;
}

.closed .ach-chevron {
  transform: rotate(-90deg);
}

@media (hover: hover) {
  .ach-group-head:hover .ach-chevron {
    stroke: var(--pb-text);
  }
}

.ach-group.closed .ach-group-title {
  margin-bottom: 0;
}

@media (max-width: 374.98px) {
  .ach-group-bar {
    display: none;
  }
}

.ach-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

/* ---------- Signed-out header ---------- */

.public-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding-top: 1.25rem;
  padding-bottom: 1.25rem;
}

.public-header .btn {
  white-space: nowrap;
}
</style>
