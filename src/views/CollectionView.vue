<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { modeRoutes } from '@/router/modes'
import { useChallengeStore } from '@/stores/challenge'
import { useCollectionStore, useModeCollectionStore } from '@/stores/collection'
import { useSetsStore } from '@/stores/sets'
import { RARITY_FILTERS, SORTS, collectionStats, filterEntries, setProgress, sortEntries } from '@/utils/collection'
import { completionPercent } from '@/utils/progress'
import { rarityLabelKey, rarityTier } from '@/utils/rarity'
import { setLogoUrl } from '@/utils/sets'
import AppHeader from '@/components/AppHeader.vue'
import ScrollTopButton from '@/components/ScrollTopButton.vue'
import BoosterArt from '@/components/BoosterArt.vue'
import CardDetail from '@/components/CardDetail.vue'
import CoinAmount from '@/components/CoinAmount.vue'
import HoloCard from '@/components/HoloCard.vue'
import PokedexGrid from '@/components/PokedexGrid.vue'
import RecycleDuplicates from '@/components/RecycleDuplicates.vue'
import WishlistGrid from '@/components/WishlistGrid.vue'
import { useWishlistStore } from '@/stores/wishlist'

// Serves both modes: /collection and /challenge/collection (the separate
// challenge collection, with coins, recycling and crafting; no wishlist).
const props = defineProps({
  mode: { type: String, default: 'unlimited' },
})
const isChallenge = props.mode === 'challenge'
const routes = modeRoutes(props.mode)

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const collectionStore = useModeCollectionStore(props.mode)
const setsStore = useSetsStore()
const wishlist = useWishlistStore()
const challenge = useChallengeStore()

// In the challenge, the empty state reminds that the unlimited cards are safe
const unlimitedStore = useCollectionStore()

onMounted(() => {
  collectionStore.load()
  setsStore.load()
  if (isChallenge) {
    challenge.load()
    unlimitedStore.load()
  } else {
    wishlist.load()
  }
})

const recycleNotice = ref('')
function onRecycled(result) {
  recycleNotice.value = t('challenge.recycledNotice', { cards: result.recycled, coins: result.gained.toLocaleString(locale.value) }, result.recycled)
}
function onRecycleError(err) {
  recycleNotice.value = t(err.code ? `challenge.errors.${err.code}` : 'challenge.errors.generic')
}

const entries = computed(() => collectionStore.entries)
const firstLoad = computed(() => collectionStore.loading && !collectionStore.loaded)

// ---------- Header stats ----------

const stats = computed(() => collectionStats(entries.value))
const poolPercent = computed(() => completionPercent(stats.value.uniqueCards, collectionStore.stats.totalCards))

const formatNumber = (value) => value.toLocaleString(locale.value)
const formatPercent = (value) => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }).format(value)
const formatEuros = (value) =>
  new Intl.NumberFormat(locale.value, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value)
// The stat tile is a third of a phone's width: €12.3K rather than €12,345
const formatEurosShort = (value) =>
  value >= 10000
    ? new Intl.NumberFormat(locale.value, { style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 1 }).format(value)
    : formatEuros(value)

// ---------- Filters (mirrored in the URL so back/forward and links work) ----------

const VIEWS = isChallenge ? ['cards', 'sets', 'pokedex'] : ['cards', 'sets', 'pokedex', 'wishlist']
const view = ref('cards')
const query = ref('')
const dex = ref(null) // national Pokédex number filter
const setId = ref('')
const rarity = ref('all')
const duplicates = ref(false)
const sort = ref('recent')

// URL -> state (initial load, and back/forward)
let syncingFromRoute = false
function readQuery(q) {
  syncingFromRoute = true
  view.value = VIEWS.includes(q.view) ? q.view : 'cards'
  dex.value = Number.parseInt(q.dex, 10) || null
  query.value = typeof q.q === 'string' ? q.q : ''
  setId.value = typeof q.set === 'string' ? q.set : ''
  rarity.value = RARITY_FILTERS.includes(q.rarity) ? q.rarity : 'all'
  duplicates.value = q.dupes === '1'
  sort.value = SORTS.includes(q.sort) ? q.sort : 'recent'
  nextTick(() => (syncingFromRoute = false))
}
readQuery(route.query)
watch(() => route.query, readQuery)

// State -> URL. Switching tab or set is a real step (back returns to it);
// typing and filter tweaks just replace the current entry.
watch([view, query, setId, rarity, duplicates, sort, dex], ([newView, , newSet, , , , newDex], [oldView, , oldSet, , , , oldDex]) => {
  if (syncingFromRoute) return
  const navigate = newView !== oldView || newSet !== oldSet || newDex !== oldDex ? router.push : router.replace
  navigate({
    query: {
      ...(view.value !== 'cards' && { view: view.value }),
      ...(query.value && { q: query.value }),
      ...(setId.value && { set: setId.value }),
      ...(rarity.value !== 'all' && { rarity: rarity.value }),
      ...(duplicates.value && { dupes: '1' }),
      ...(sort.value !== 'recent' && { sort: sort.value }),
      ...(dex.value && { dex: String(dex.value) }),
    },
  })
})

const isFiltered = computed(() => query.value || setId.value || rarity.value !== 'all' || duplicates.value || dex.value)

function resetFilters() {
  query.value = ''
  setId.value = ''
  rarity.value = 'all'
  duplicates.value = false
  dex.value = null
}

// Sets the user owns cards from, for the set filter
const ownedSets = computed(() => {
  const ids = new Set(entries.value.map((entry) => entry.cards.set_id))
  return setsStore.sets.filter((set) => ids.has(set.id)).sort((a, b) => a.name.localeCompare(b.name))
})

const results = computed(() =>
  sortEntries(
    filterEntries(entries.value, {
      query: query.value,
      setId: setId.value,
      rarity: rarity.value,
      duplicates: duplicates.value,
      dex: dex.value,
    }),
    sort.value,
    setsStore.byId,
  ),
)

// ---------- Progressive rendering (thousands of cards stay smooth) ----------

const PAGE = 48
const visibleCount = ref(PAGE)
const visible = computed(() => results.value.slice(0, visibleCount.value))
watch(results, () => (visibleCount.value = PAGE))

const sentinel = ref(null)
let observer = null
onMounted(() => {
  observer = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting && visibleCount.value < results.value.length) visibleCount.value += PAGE
    },
    { rootMargin: '600px' },
  )
})
watch(sentinel, (el, old) => {
  if (old) observer?.unobserve(old)
  if (el) observer?.observe(el)
})
onBeforeUnmount(() => observer?.disconnect())

// ---------- Sets view ----------

const progress = computed(() => setProgress(entries.value, setsStore.sets))

// A set tile opens that set's binder
function showSet(id) {
  router.push({ name: routes.binder, params: { setId: id } })
}

// A Pokédex slot shows every card of that Pokémon
function showDex(number) {
  resetFilters()
  dex.value = number
  view.value = 'cards'
  window.scrollTo({ top: 0 })
}

// ---------- Card detail ----------

// The detail dialog browses either the filtered cards or the wishlist
const detail = ref({ list: 'results', index: -1 })
const detailList = computed(() => (detail.value.list === 'wishlist' ? wishlist.entries : results.value))
const openEntry = computed(() => {
  const item = detailList.value[detail.value.index]
  if (!item) return null
  if (detail.value.list === 'results') return item
  return entries.value.find((e) => e.card_id === item.card_id) ?? { card_id: item.card_id, quantity: 0, acquired_at: null, cards: item.cards }
})
const openDetail = (list, index) => (detail.value = { list, index })
const moveDetail = (step) => (detail.value = { ...detail.value, index: detail.value.index + step })

function rarityChip(card) {
  const key = rarityLabelKey(card)
  return key === 'common' || key === 'uncommon' ? null : t(`boosters.bucket.${key}`)
}
</script>

<template>
  <div class="pb-page">
    <AppHeader />

    <main class="container collection">
      <!-- ============ Header ============ -->
      <header class="coll-head">
        <span class="pb-eyebrow">{{ t('collection.eyebrow') }}</span>
        <h1 class="coll-title">{{ isChallenge ? t('challenge.collectionTitle') : t('collection.title') }}</h1>

        <div v-if="isChallenge && entries.length" class="coll-challenge">
          <p class="coll-balance">
            {{ t('challenge.balance') }} <strong><CoinAmount :amount="challenge.coins" /></strong>
          </p>
          <RecycleDuplicates class="coll-recycle" @recycled="onRecycled" @error="onRecycleError" />
          <p v-if="recycleNotice" class="coll-recycle-notice" role="status">{{ recycleNotice }}</p>
        </div>

        <dl v-if="!firstLoad && entries.length" class="coll-stats">
          <div class="coll-stat coll-stat-main">
            <dt>{{ t('collection.statUnique') }}</dt>
            <dd>
              {{ formatNumber(stats.uniqueCards) }}
              <span class="coll-stat-total">/ {{ formatNumber(collectionStore.stats.totalCards) }}</span>
            </dd>
            <div
              class="coll-progress"
              role="progressbar"
              :aria-label="t('game.progressLabel')"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-valuenow="poolPercent"
            >
              <span :style="{ width: `${Math.max(poolPercent, 1.5)}%` }"></span>
            </div>
            <p class="coll-stat-note">{{ t('game.progress', { percent: formatPercent(poolPercent) }) }}</p>
          </div>
          <div class="coll-stat">
            <dt>{{ t('collection.statPulled') }}</dt>
            <dd>{{ formatNumber(stats.totalCards) }}</dd>
          </div>
          <div class="coll-stat">
            <dt>{{ t('collection.statSets') }}</dt>
            <dd>{{ formatNumber(stats.setsStarted) }}</dd>
          </div>
          <div class="coll-stat">
            <dt>{{ t('collection.statValue') }}</dt>
            <dd class="coll-stat-value" :title="formatEuros(stats.value)">{{ formatEurosShort(stats.value) }}</dd>
            <p class="coll-stat-note">{{ t('collection.valueNote') }}</p>
          </div>
        </dl>
      </header>

      <div v-if="collectionStore.error" class="alert alert-danger" role="alert">{{ t('collection.loadError') }}</div>

      <!-- Loading -->
      <div v-else-if="firstLoad" class="coll-grid" aria-busy="true">
        <div v-for="n in 12" :key="n" class="pb-skeleton" style="aspect-ratio: 63 / 88"></div>
      </div>

      <!-- Empty collection -->
      <div v-else-if="!entries.length" class="coll-empty">
        <BoosterArt class="coll-empty-art" />
        <div>
          <template v-if="isChallenge">
            <h2 class="coll-empty-title">{{ t('challenge.emptyTitle') }}</h2>
            <p class="pb-muted">
              {{ t('challenge.emptyDesc') }}
              <template v-if="unlimitedStore.entries.length">
                {{ t('challenge.emptyUnlimitedSafe', { count: unlimitedStore.entries.length.toLocaleString(locale) }, unlimitedStore.entries.length) }}
              </template>
            </p>
            <div class="coll-empty-actions">
              <RouterLink :to="{ name: routes.boosters }" class="btn btn-primary btn-lg glow-button">
                {{ t('challenge.openCta') }}
              </RouterLink>
              <RouterLink :to="{ name: 'collection' }" class="btn btn-outline-secondary btn-lg">
                {{ t('challenge.seeUnlimitedCollection') }}
              </RouterLink>
            </div>
          </template>
          <template v-else>
            <h2 class="coll-empty-title">{{ t('collection.emptyTitle') }}</h2>
            <p class="pb-muted">{{ t('collection.empty') }}</p>
            <RouterLink :to="{ name: routes.boosters }" class="btn btn-primary btn-lg glow-button">
              {{ t('collection.goOpen') }}
            </RouterLink>
          </template>
        </div>
      </div>

      <template v-else>
        <!-- ============ Tabs ============ -->
        <div class="coll-tabs" role="tablist" :aria-label="t('collection.title')">
          <button type="button" role="tab" :aria-selected="view === 'cards'" :class="{ active: view === 'cards' }" @click="view = 'cards'">
            {{ t('collection.tabCards') }}
            <span class="coll-tab-count">{{ formatNumber(stats.uniqueCards) }}</span>
          </button>
          <button type="button" role="tab" :aria-selected="view === 'sets'" :class="{ active: view === 'sets' }" @click="view = 'sets'">
            {{ t('collection.tabSets') }}
            <span class="coll-tab-count">{{ formatNumber(stats.setsStarted) }}</span>
          </button>
          <button type="button" role="tab" :aria-selected="view === 'pokedex'" :class="{ active: view === 'pokedex' }" @click="view = 'pokedex'">
            {{ t('collection.tabPokedex') }}
          </button>
          <button v-if="!isChallenge" type="button" role="tab" :aria-selected="view === 'wishlist'" :class="{ active: view === 'wishlist' }" @click="view = 'wishlist'">
            {{ t('collection.tabWishlist') }}
            <span v-if="wishlist.entries.length" class="coll-tab-count">{{ formatNumber(wishlist.entries.length) }}</span>
          </button>
        </div>

        <!-- ============ Cards ============ -->
        <section v-if="view === 'cards'" class="coll-cards">
          <div class="coll-toolbar">
            <div class="coll-search">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4" /></svg>
              <input
                v-model="query"
                type="search"
                class="form-control"
                :placeholder="t('collection.searchPlaceholder')"
                :aria-label="t('collection.searchLabel')"
              />
            </div>
            <select v-model="setId" class="form-select" :aria-label="t('collection.setFilter')">
              <option value="">{{ t('collection.allSets') }}</option>
              <option v-for="set in ownedSets" :key="set.id" :value="set.id">{{ set.name }}</option>
            </select>
            <select v-model="sort" class="form-select" :aria-label="t('collection.sortLabel')">
              <option v-for="option in SORTS" :key="option" :value="option">{{ t(`collection.sort.${option}`) }}</option>
            </select>
          </div>

          <div class="coll-chips" role="group" :aria-label="t('collection.rarityFilter')">
            <button
              v-for="option in RARITY_FILTERS"
              :key="option"
              type="button"
              class="coll-chip"
              :class="{ active: rarity === option }"
              :aria-pressed="rarity === option"
              @click="rarity = option"
            >
              {{ t(`collection.rarityFilters.${option}`) }}
            </button>
            <button
              type="button"
              class="coll-chip"
              :class="{ active: duplicates }"
              :aria-pressed="duplicates"
              @click="duplicates = !duplicates"
            >
              {{ t('collection.duplicatesOnly') }}
            </button>
          </div>

          <p class="coll-count" aria-live="polite">
            {{ t('collection.resultCount', { count: formatNumber(results.length) }, results.length) }}
            <button v-if="dex" type="button" class="coll-active-filter" @click="dex = null">
              {{ t('collection.dexFilter', { number: String(dex).padStart(4, '0') }) }} <span aria-hidden="true">×</span>
            </button>
            <RouterLink v-if="setId" :to="{ name: routes.binder, params: { setId } }" class="coll-reset">
              {{ t('collection.openBinder') }}
            </RouterLink>
            <button v-if="isFiltered" type="button" class="btn btn-link coll-reset" @click="resetFilters">
              {{ t('collection.resetFilters') }}
            </button>
          </p>

          <p v-if="!results.length" class="coll-no-results">{{ t('collection.noResults') }}</p>

          <ul v-else class="coll-grid" role="list">
            <li v-for="(entry, index) in visible" :key="entry.card_id">
              <button
                type="button"
                class="coll-card"
                :data-tier="rarityTier(entry.cards)"
                :aria-label="t('collection.openCard', { name: entry.cards.name })"
                @click="openDetail('results', index)"
              >
                <span class="coll-card-img">
                  <HoloCard :src="entry.cards.image_small || entry.cards.image_url" alt="" :max-tilt="10" />
                  <span v-if="entry.quantity > 1" class="coll-qty">
                    {{ t('collection.quantity', { quantity: entry.quantity }) }}
                  </span>
                </span>
                <span class="coll-card-name">{{ entry.cards.name }}</span>
                <span v-if="rarityChip(entry.cards)" class="coll-card-rarity" :data-tier="rarityTier(entry.cards)">
                  {{ rarityChip(entry.cards) }}
                </span>
              </button>
            </li>
          </ul>
          <div v-if="visibleCount < results.length" ref="sentinel" class="coll-sentinel" aria-hidden="true"></div>
        </section>

        <!-- ============ Pokédex ============ -->
        <PokedexGrid v-else-if="view === 'pokedex'" :entries="entries" @select="showDex" />

        <!-- ============ Wishlist ============ -->
        <WishlistGrid v-else-if="view === 'wishlist' && !isChallenge" @open="(index) => openDetail('wishlist', index)" />

        <!-- ============ Sets ============ -->
        <section v-else class="coll-sets">
          <ul class="coll-set-grid" role="list">
            <li v-for="item in progress" :key="item.set.id">
              <button type="button" class="coll-set" :class="{ complete: item.owned >= item.total }" @click="showSet(item.set.id)">
                <span class="coll-set-plate"><img :src="setLogoUrl(item.set)" alt="" loading="lazy" /></span>
                <span class="coll-set-body">
                  <span class="coll-set-name">
                    {{ item.set.name }}
                    <span v-if="item.owned >= item.total" class="coll-set-complete">{{ t('collection.complete') }}</span>
                  </span>
                  <span class="coll-set-meta">
                    {{ t('collection.setOwned', { owned: formatNumber(item.owned), total: formatNumber(item.total) }) }}
                    · {{ formatPercent(item.percent) }} %
                  </span>
                  <span class="coll-progress coll-progress-sm" aria-hidden="true">
                    <span :style="{ width: `${Math.max(item.percent, 2)}%` }"></span>
                  </span>
                </span>
              </button>
            </li>
          </ul>
        </section>
      </template>
    </main>
    <ScrollTopButton />

    <CardDetail
      :entry="openEntry"
      :set="openEntry ? setsStore.byId[openEntry.cards.set_id] : null"
      :has-prev="detail.index > 0"
      :has-next="detail.index < detailList.length - 1"
      :mode="mode"
      @prev="moveDetail(-1)"
      @next="moveDetail(1)"
      @close="detail = { list: 'results', index: -1 }"
    />
  </div>
</template>

<style scoped>
.collection {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  padding-top: 1rem;
}

/* ---------- Header ---------- */

.coll-empty-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.coll-challenge {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1.5rem;
  margin: -0.5rem 0 1.5rem;
  padding: 0.9rem 1.1rem;
  border-radius: var(--pb-radius-md);
  border: 1px solid var(--pb-border);
  background: var(--pb-surface);
}

.coll-balance {
  margin: 0;
  font-weight: 600;
}

.coll-balance strong {
  color: var(--pb-coin);
}

.coll-recycle {
  flex: 1;
}

.coll-recycle-notice {
  flex-basis: 100%;
  margin: 0;
  color: var(--pb-text-muted);
  font-size: 0.9rem;
  font-weight: 600;
}

.coll-head {
  animation: pb-rise 0.6s var(--pb-ease-out) both;
}

.coll-title {
  margin: 1rem 0 1.5rem;
  font-size: clamp(1.8rem, 5vw, 2.8rem);
  font-weight: 800;
}

/* Phones: the pool progress full width, then the three counts in one
   compact row, so the cards start on the first screen */
.coll-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
  margin: 0;
}

.coll-stat {
  min-width: 0;
  padding: 0.7rem 0.8rem;
  border-radius: var(--pb-radius-md);
  border: 1px solid var(--pb-border);
  background: var(--pb-surface);
}

.coll-stat-main {
  grid-column: 1 / -1;
}

.coll-stat dt {
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--pb-text-muted);
}

.coll-stat dd {
  margin: 0.3rem 0 0;
  font-family: var(--pb-font-display);
  font-size: 1.15rem;
  white-space: nowrap;
  font-weight: 800;
  line-height: 1.1;
}

.coll-stat-main dd {
  font-size: 1.7rem;
}

@media (max-width: 767.98px) {
  .coll-stat dt {
    font-size: 0.65rem;
  }

  .coll-stat:not(.coll-stat-main) .coll-stat-note {
    display: none;
  }
}

@media (max-width: 374.98px) {
  .coll-stat dd {
    font-size: 1rem;
  }

  .coll-stat-main dd {
    font-size: 1.5rem;
  }

  .coll-tabs .coll-tab-count {
    display: none;
  }
}

.coll-stat-total {
  font-size: 1rem;
  font-weight: 600;
  color: var(--pb-text-muted);
}

.coll-stat-note {
  margin: 0.4rem 0 0;
  font-size: 0.8rem;
  color: var(--pb-text-muted);
}

.coll-progress {
  display: block;
  height: 10px;
  margin-top: 0.75rem;
  border-radius: 999px;
  background: var(--pb-input-bg);
  border: 1px solid var(--pb-border);
  overflow: hidden;
}

.coll-progress span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--pb-holo);
  transition: width 0.8s var(--pb-ease-out);
}

.coll-progress-sm {
  height: 6px;
  margin-top: 0.5rem;
}

/* ---------- Tabs ---------- */

/* Phones: the tabs share the full width, so none is cut off */
.coll-tabs {
  display: flex;
  width: 100%;
  overflow-x: auto;
  scrollbar-width: none;
  gap: 4px;
  padding: 4px;
  border-radius: var(--pb-radius-md);
  border: 1px solid var(--pb-border-strong);
  background: var(--pb-surface);
}

.coll-tabs button {
  flex: 1 1 0;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  padding: 0.55rem 0.35rem;
  font-size: 0.85rem;
  white-space: nowrap;
  border: none;
  border-radius: calc(var(--pb-radius-md) - 4px);
  background: none;
  color: var(--pb-text-muted);
  font-weight: 700;
  transition:
    background-color 0.2s,
    color 0.2s;
}

.coll-tabs button.active {
  background: var(--pb-text);
  color: var(--pb-bg);
}

.coll-tab-count {
  font-size: 0.75rem;
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  background: var(--pb-selected);
}

.coll-tabs button.active .coll-tab-count {
  background: color-mix(in srgb, var(--pb-bg) 18%, transparent);
}

/* ---------- Toolbar ---------- */

.coll-cards {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.coll-toolbar {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.6rem;
}

.coll-search {
  position: relative;
  grid-column: 1 / -1;
}

.coll-search svg {
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

.coll-search .form-control {
  padding-left: 2.6rem;
}

.coll-chips {
  display: flex;
  gap: 0.4rem;
  margin: 0 calc(var(--bs-gutter-x) * -0.5);
  padding: 0 calc(var(--bs-gutter-x) * 0.5) 2px;
  overflow-x: auto;
  scrollbar-width: none;
}

.coll-chip {
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
    color 0.2s,
    border-color 0.2s;
}

.coll-chip:hover {
  color: var(--pb-text);
}

.coll-chip.active {
  background: var(--pb-text);
  border-color: var(--pb-text);
  color: var(--pb-bg);
}

.coll-count {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  margin: 0;
  color: var(--pb-text-muted);
  font-weight: 600;
}

.coll-active-filter {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.2rem 0.7rem;
  border-radius: 999px;
  border: none;
  background: var(--pb-text);
  color: var(--pb-bg);
  font-size: 0.8rem;
  font-weight: 700;
}

.coll-reset {
  padding: 0;
  font-weight: 700;
  font-size: 0.9rem;
}

.coll-no-results {
  padding: 2rem 0;
  text-align: center;
  color: var(--pb-text-muted);
}

/* ---------- Card grid ---------- */

.coll-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
  gap: 1.25rem 0.9rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.coll-card {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  width: 100%;
  padding: 0;
  border: none;
  background: none;
  color: var(--pb-text);
  text-align: left;
  border-radius: var(--pb-radius-sm);
}

.coll-card-img {
  position: relative;
  display: block;
  border-radius: 4.5% / 3.2%;
}

/* Rare cards get a faint holo halo in the grid too */
.coll-card[data-tier='rare'] .coll-card-img,
.coll-card[data-tier='ultra'] .coll-card-img {
  box-shadow: 0 0 0 1px color-mix(in srgb, #a78bfa 35%, transparent);
}

.coll-card[data-tier='ultra'] .coll-card-img::before {
  content: '';
  position: absolute;
  inset: -4%;
  border-radius: 10%;
  background: var(--pb-holo);
  filter: blur(14px);
  opacity: 0.45;
}

.coll-qty {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 1;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(10, 13, 26, 0.85);
  color: #fff;
  font-size: 0.75rem;
  font-weight: 800;
}

.coll-card-name {
  font-size: 0.85rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.coll-card-rarity {
  align-self: flex-start;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  border: 1px solid var(--pb-border-strong);
  font-size: 0.62rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.coll-card-rarity[data-tier='ultra'] {
  color: #0a0d1a;
  border-color: transparent;
  background: var(--pb-holo);
}

.coll-sentinel {
  height: 1px;
}

/* ---------- Sets ---------- */

.coll-set-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.coll-set {
  display: flex;
  align-items: center;
  gap: 1rem;
  width: 100%;
  padding: 0.75rem;
  border-radius: var(--pb-radius-md);
  border: 1px solid var(--pb-border);
  background: var(--pb-surface);
  color: var(--pb-text);
  text-align: left;
  transition:
    border-color 0.2s,
    background-color 0.2s;
}

.coll-set:hover {
  border-color: var(--pb-border-strong);
  background: var(--pb-surface-hover);
}

.coll-set.complete {
  border: 2px solid transparent;
  padding: calc(0.75rem - 1px);
  background:
    linear-gradient(var(--pb-bg-elevated), var(--pb-bg-elevated)) padding-box,
    var(--pb-holo) border-box;
}

/* Logos are drawn for dark packaging: dark plate in both themes */
.coll-set-plate {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 92px;
  height: 48px;
  padding: 6px 8px;
  border-radius: var(--pb-radius-sm);
  background: linear-gradient(160deg, #1d2450, #0a0d1a);
}

.coll-set-plate img {
  max-width: 76px;
  max-height: 36px;
  object-fit: contain;
}

.coll-set-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.coll-set-name {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 700;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.coll-set-complete {
  flex-shrink: 0;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  background: var(--pb-accent);
  color: var(--pb-accent-ink);
  font-size: 0.62rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.coll-set-meta {
  font-size: 0.8rem;
  color: var(--pb-text-muted);
}

/* ---------- Empty ---------- */

.coll-empty {
  display: flex;
  align-items: center;
  gap: 2rem;
  padding: 2rem;
  border-radius: var(--pb-radius-lg);
  border: 1px dashed var(--pb-border-strong);
}

.coll-empty-art {
  --booster-w: 110px;
  flex-shrink: 0;
  transform: rotate(-6deg);
}

.coll-empty-title {
  font-size: 1.3rem;
  margin: 0 0 0.5rem;
}

@media (max-width: 575.98px) {
  .coll-empty {
    flex-direction: column;
    text-align: center;
  }
}

/* ---------- Breakpoints ---------- */

@media (min-width: 768px) {
  .coll-stats {
    grid-template-columns: minmax(0, 2fr) repeat(3, minmax(0, 1fr));
    gap: 0.75rem;
  }

  .coll-stat {
    padding: 1rem 1.1rem;
  }

  .coll-stat dd {
    font-size: 1.5rem;
  }

  .coll-stat-main dd {
    font-size: 2rem;
  }

  .coll-stat-main {
    grid-column: auto;
  }

  .coll-tabs {
    display: inline-flex;
    width: auto;
    align-self: flex-start;
    max-width: 100%;
  }

  .coll-tabs button {
    flex: 0 0 auto;
    gap: 0.5rem;
    padding: 0.55rem 1rem;
    font-size: 1rem;
  }

  .coll-toolbar {
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr);
  }

  .coll-search {
    grid-column: auto;
  }

  .coll-grid {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 1.5rem 1.1rem;
  }
}
</style>
