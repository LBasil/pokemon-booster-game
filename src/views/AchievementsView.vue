<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { fetchPublicCollection, fetchPublicProfile } from '@/api/profiles'
import { useAuthStore } from '@/stores/auth'
import { useAchievementsStore } from '@/stores/achievements'
import { useCollectionStore } from '@/stores/collection'
import { useSetsStore } from '@/stores/sets'
import { useAchievementText } from '@/composables/useAchievementText'
import { CATEGORIES, STATUSES, achievementProgress, achievements, filterAchievements, rateOf } from '@/utils/achievements'
import AchievementTile from '@/components/AchievementTile.vue'
import AppHeader from '@/components/AppHeader.vue'
import BrandLogo from '@/components/BrandLogo.vue'

// Every achievement, by category, with search + category/status filters
// (synced to the URL). Serves /achievements (own) and
// /u/:username/achievements (public, works signed out), like ProfileView.
const props = defineProps({
  username: { type: String, default: '' },
})

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const collectionStore = useCollectionStore()
const setsStore = useSetsStore()
const text = useAchievementText()
const achievementsStore = useAchievementsStore()

const isOwn = computed(() => !props.username)

// ---------- Data ----------

const publicName = ref('')
const publicEntries = ref([])
const publicState = ref('idle') // loading | ready | missing | error

async function loadPublic(username) {
  publicState.value = 'loading'
  try {
    const profile = await fetchPublicProfile(username)
    if (!profile) {
      publicState.value = 'missing'
      return
    }
    publicName.value = profile.username
    publicEntries.value = await fetchPublicCollection(profile.username)
    publicState.value = 'ready'
  } catch {
    publicState.value = 'error'
  }
}

onMounted(() => {
  setsStore.load()
  achievementsStore.loadRates()
  // Own page: also toasts anything unlocked since the last check
  if (isOwn.value) achievementsStore.check()
  else loadPublic(props.username)
})

const entries = computed(() => (isOwn.value ? collectionStore.entries : publicEntries.value))
const firstLoad = computed(() => (isOwn.value ? !collectionStore.loaded : publicState.value === 'loading'))
const failed = computed(() => (isOwn.value ? collectionStore.error && !collectionStore.loaded : publicState.value === 'error'))

const list = computed(() => achievements(entries.value, setsStore.sets))
const progress = computed(() => achievementProgress(list.value))
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

const title = computed(() => (isOwn.value ? t('achievements.ui.title') : t('achievements.ui.publicTitle', { name: publicName.value || props.username })))
const backRoute = computed(() => (isOwn.value ? { name: 'profile' } : { name: 'public-profile', params: { username: props.username } }))
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
        <RouterLink :to="backRoute" class="ach-back">
          <span aria-hidden="true">←</span> {{ t('achievements.ui.backToProfile') }}
        </RouterLink>
        <h1 class="ach-title">{{ title }}</h1>
      </header>

      <div v-if="publicState === 'missing'" class="alert alert-danger" role="alert">{{ t('profile.notFound', { name: username }) }}</div>
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
              <template v-if="achievementsStore.rates?.players">{{ t('achievements.ui.rateNote') }}</template>
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
          <button v-if="isFiltered" type="button" class="btn btn-link ach-clear" @click="resetFilters">{{ t('achievements.ui.clear') }}</button>
        </div>

        <p v-if="!results.length" class="ach-empty">{{ t('achievements.ui.empty') }}</p>

        <section v-for="group in groups" :key="group.category" class="ach-group" :aria-labelledby="`ach-${group.category}`">
          <div class="ach-group-head">
            <h2 :id="`ach-${group.category}`" class="pb-section-title">{{ t(`achievements.categories.${group.category}`) }}</h2>
            <span class="ach-group-count">{{ group.unlocked }} / {{ group.total }}</span>
          </div>
          <ul class="ach-grid" role="list">
            <AchievementTile v-for="item in group.items" :key="item.id" :item="item" :rate="rateOf(item, achievementsStore.rates, isOwn)" />
          </ul>
        </section>
      </template>
    </main>
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

.ach-group-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.ach-group-count {
  font-weight: 700;
  color: var(--pb-text-muted);
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
