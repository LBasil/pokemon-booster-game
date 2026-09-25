<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { fetchCardsByIds } from '@/api/cards'
import { fetchPlayerAchievements } from '@/api/achievements'
import { fetchOpenings } from '@/api/history'
import { modeRoutes } from '@/router/modes'
import { useModeCollectionStore } from '@/stores/collection'
import { useSetsStore } from '@/stores/sets'
import { collectionStats } from '@/utils/collection'
import { packSummary } from '@/utils/profile'
import { rarityLabelKey, rarityTier, sortForReveal } from '@/utils/rarity'
import { setLogoUrl } from '@/utils/sets'
import AppHeader from '@/components/AppHeader.vue'

// Past boosters, newest first, 20 at a time. Each row expands to show its
// 10 cards (fetched once, then cached). Serves /history and
// /challenge/history (challenge packs, god packs flagged).
const props = defineProps({
  mode: { type: String, default: 'unlimited' },
})
const routes = modeRoutes(props.mode)

const { t, locale } = useI18n()
const setsStore = useSetsStore()

const PAGE = 20
const openings = ref([])
const cardsById = ref({})
const loading = ref(false)
const done = ref(false)
const loadError = ref(false)
const expanded = ref(new Set())

async function loadMore() {
  if (loading.value || done.value) return
  loading.value = true
  loadError.value = false
  try {
    const page = await fetchOpenings({ mode: props.mode, before: openings.value.at(-1)?.opened_at, limit: PAGE })
    openings.value.push(...page)
    if (page.length < PAGE) done.value = true
    // Best cards up front, so the collapsed rows can show them
    const missing = [...new Set(page.map((o) => o.best_card_id).filter((id) => id && !cardsById.value[id]))]
    await addCards(missing)
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

async function addCards(ids) {
  if (!ids.length) return
  const cards = await fetchCardsByIds(ids)
  cardsById.value = { ...cardsById.value, ...Object.fromEntries(cards.map((card) => [card.id, card])) }
}

async function toggle(opening) {
  const next = new Set(expanded.value)
  if (next.has(opening.id)) {
    next.delete(opening.id)
  } else {
    next.add(opening.id)
    await addCards(opening.card_ids.filter((id) => !cardsById.value[id]))
  }
  expanded.value = next
}

// ---------- Totals: exact pack count + the server's stats (migration 0010) ----------

const collectionStore = useModeCollectionStore(props.mode)
const server = ref(null)
const serverLoaded = ref(false)

async function loadTotals() {
  try {
    server.value = await fetchPlayerAchievements(props.mode)
  } catch {
    server.value = null
  } finally {
    serverLoaded.value = true
  }
}

const summary = computed(() =>
  packSummary({ mode: props.mode, totalCards: collectionStats(collectionStore.entries).totalCards, server: server.value }),
)
// The unlimited count needs the collection; the challenge one only the server
const totalsReady = computed(() => serverLoaded.value && (props.mode === 'challenge' || collectionStore.loaded))
const hitRate = computed(() => {
  const stats = summary.value.stats
  return stats?.packs ? Math.round((stats.hit_packs / stats.packs) * 100) : null
})
const since = computed(() => {
  const at = summary.value.stats?.first_at
  return at ? new Date(at).toLocaleDateString(locale.value, { day: 'numeric', month: 'long', year: 'numeric' }) : ''
})
const formatNumber = (value) => value.toLocaleString(locale.value)

onMounted(() => {
  setsStore.load()
  collectionStore.load()
  loadTotals()
  loadMore()
})

const packCards = (opening) => sortForReveal(opening.card_ids.map((id) => cardsById.value[id]).filter(Boolean)).reverse()

// Group rows by day for readability
const groups = computed(() => {
  const byDay = new Map()
  for (const opening of openings.value) {
    const day = new Date(opening.opened_at).toLocaleDateString(locale.value, { weekday: 'long', day: 'numeric', month: 'long' })
    if (!byDay.has(day)) byDay.set(day, [])
    byDay.get(day).push(opening)
  }
  return [...byDay].map(([day, list]) => ({ day, list }))
})

const time = (iso) => new Date(iso).toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' })

function chip(card) {
  const key = rarityLabelKey(card)
  return key === 'common' || key === 'uncommon' ? null : t(`boosters.bucket.${key}`)
}
</script>

<template>
  <div class="pb-page">
    <AppHeader />

    <main class="container history">
      <header>
        <RouterLink :to="{ name: mode === 'challenge' ? 'challenge' : 'profile' }" class="history-back">
          <span aria-hidden="true">←</span> {{ mode === 'challenge' ? t('challenge.backToHub') : t('history.backToProfile') }}
        </RouterLink>
        <span class="pb-eyebrow">{{ t('history.eyebrow') }}</span>
        <h1 class="history-title">{{ mode === 'challenge' ? t('challenge.historyTitle') : t('history.title') }}</h1>
        <p class="pb-muted">{{ t('history.subtitle') }}</p>
      </header>

      <section class="history-totals" :aria-label="t('history.totalsTitle')">
        <div v-if="!totalsReady" class="pb-skeleton" style="height: 96px"></div>
        <template v-else>
          <dl class="totals-grid">
            <div class="total total-main">
              <dt>{{ t('history.totalPacks') }}</dt>
              <dd>{{ formatNumber(summary.total) }}</dd>
            </div>
            <template v-if="summary.stats">
              <div class="total">
                <dt>{{ t('history.today') }}</dt>
                <dd>{{ formatNumber(summary.stats.today) }}</dd>
              </div>
              <div class="total">
                <dt>{{ t('history.bestDay') }}</dt>
                <dd>{{ formatNumber(summary.stats.best_day) }}</dd>
              </div>
              <div class="total">
                <dt>{{ t('history.hitPacks') }}</dt>
                <dd>
                  {{ formatNumber(summary.stats.hit_packs) }}
                  <small v-if="hitRate !== null">({{ hitRate }} %)</small>
                </dd>
              </div>
              <div class="total">
                <dt>{{ t('history.bestStreak') }}</dt>
                <dd>{{ t('history.days', { count: summary.stats.best_streak }, summary.stats.best_streak) }}</dd>
              </div>
              <div v-if="summary.stats.top_set_id" class="total">
                <dt>{{ t('history.topSet') }}</dt>
                <dd class="total-set">
                  {{ setsStore.byId[summary.stats.top_set_id]?.name ?? summary.stats.top_set_id }}
                  <small>× {{ formatNumber(summary.stats.top_set_packs) }}</small>
                </dd>
              </div>
            </template>
          </dl>
          <p v-if="summary.stats && summary.unlogged > 0" class="totals-note">
            {{ t('history.unloggedNote', { count: summary.unlogged, logged: summary.logged, date: since }, summary.unlogged) }}
          </p>
          <p v-else-if="summary.stats && since" class="totals-note">{{ t('history.since', { date: since }) }}</p>
        </template>
      </section>

      <div v-if="loadError && !openings.length" class="alert alert-danger" role="alert">{{ t('history.loadError') }}</div>

      <div v-else-if="!openings.length && loading" class="history-list">
        <div v-for="n in 5" :key="n" class="pb-skeleton" style="height: 76px"></div>
      </div>

      <div v-else-if="!openings.length" class="history-empty">
        <p>{{ t('history.empty') }}</p>
        <RouterLink :to="{ name: routes.boosters }" class="btn btn-primary glow-button">{{ t('game.openCta') }}</RouterLink>
      </div>

      <section v-for="group in groups" :key="group.day" class="history-day">
        <h2 class="history-day-title">{{ group.day }}</h2>
        <ul class="history-list" role="list">
          <li v-for="opening in group.list" :key="opening.id" class="history-item" :class="{ open: expanded.has(opening.id) }">
            <button type="button" class="history-row" :aria-expanded="expanded.has(opening.id)" @click="toggle(opening)">
              <span class="history-plate">
                <img v-if="setsStore.byId[opening.set_id]" :src="setLogoUrl(setsStore.byId[opening.set_id])" alt="" loading="lazy" />
              </span>
              <span class="history-main">
                <span class="history-set">{{ setsStore.byId[opening.set_id]?.name ?? opening.set_id }}</span>
                <span class="history-meta">
                  {{ time(opening.opened_at) }}
                  <template v-if="opening.hits"> · {{ t('history.hits', { count: opening.hits }, opening.hits) }}</template>
                  <span v-if="opening.god_pack" class="history-god">{{ t('challenge.godPack') }}</span>
                </span>
              </span>
              <span v-if="cardsById[opening.best_card_id]" class="history-best" :data-tier="rarityTier(cardsById[opening.best_card_id])">
                <img :src="cardsById[opening.best_card_id].image_small" :alt="cardsById[opening.best_card_id].name" loading="lazy" />
              </span>
              <svg class="history-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
            </button>

            <ul v-if="expanded.has(opening.id)" class="history-cards" role="list">
              <li v-for="(card, i) in packCards(opening)" :key="`${card.id}-${i}`" class="history-card">
                <img :src="card.image_small" :alt="card.name" loading="lazy" />
                <span class="history-card-name">{{ card.name }}</span>
                <span v-if="chip(card)" class="history-chip" :data-tier="rarityTier(card)">{{ chip(card) }}</span>
              </li>
            </ul>
          </li>
        </ul>
      </section>

      <button v-if="openings.length && !done" type="button" class="btn btn-outline-secondary history-more" :disabled="loading" @click="loadMore">
        <span v-if="loading" class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
        {{ t('history.more') }}
      </button>
    </main>
  </div>
</template>

<style scoped>
.history {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  padding-top: 1rem;
}

.history-back {
  display: block;
  width: fit-content;
  margin-bottom: 1rem;
  font-weight: 700;
  color: var(--pb-text-muted);
}

.history-back:hover {
  color: var(--pb-text);
}

.history-title {
  margin: 1rem 0 0.5rem;
  font-size: clamp(1.8rem, 5vw, 2.6rem);
  font-weight: 800;
}

.totals-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 0.5rem;
  margin: 0;
}

.total {
  padding: 0.75rem 0.9rem;
  border-radius: var(--pb-radius-md);
  border: 1px solid var(--pb-border);
  background: var(--pb-surface);
}

.total dt {
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--pb-text-muted);
}

.total dd {
  margin: 0.2rem 0 0;
  font-family: var(--pb-font-display);
  font-size: 1.3rem;
  font-weight: 700;
}

.total dd small {
  font-family: var(--pb-font-body);
  font-size: 0.8rem;
  color: var(--pb-text-muted);
}

.total-main dd {
  font-size: 2rem;
  line-height: 1.1;
}

.total-set {
  font-size: 1rem !important;
  overflow-wrap: anywhere;
}

.totals-note {
  margin: 0.6rem 0 0;
  font-size: 0.8rem;
  color: var(--pb-text-muted);
}

.history-day-title {
  margin: 0 0 0.6rem;
  font-family: var(--pb-font-body);
  font-size: 0.8rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--pb-text-muted);
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.history-item {
  border-radius: var(--pb-radius-md);
  border: 1px solid var(--pb-border);
  background: var(--pb-surface);
  overflow: hidden;
}

.history-row {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  width: 100%;
  padding: 0.6rem 0.9rem 0.6rem 0.6rem;
  border: none;
  background: none;
  color: var(--pb-text);
  text-align: left;
}

/* Logos are drawn for dark packaging: dark plate in both themes */
.history-plate {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 84px;
  height: 44px;
  padding: 5px 7px;
  border-radius: var(--pb-radius-sm);
  background: linear-gradient(160deg, #1d2450, #0a0d1a);
}

.history-plate img {
  max-width: 70px;
  max-height: 34px;
  object-fit: contain;
}

.history-main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.history-set {
  font-weight: 700;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.history-meta {
  font-size: 0.8rem;
  color: var(--pb-text-muted);
}

.history-god {
  display: inline-block;
  margin-left: 0.4rem;
  padding: 0 0.45rem;
  border-radius: 999px;
  background: var(--pb-holo);
  color: #0a0d1a;
  font-size: 0.65rem;
  font-weight: 800;
  text-transform: uppercase;
}

.history-best img {
  display: block;
  width: 40px;
  border-radius: 3px;
  box-shadow: var(--pb-shadow-card);
}

.history-best[data-tier='ultra'] img {
  box-shadow: 0 0 0 2px var(--pb-ring), 0 0 14px color-mix(in srgb, var(--pb-ring) 60%, transparent);
}

.history-chevron {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  fill: none;
  stroke: var(--pb-text-muted);
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: transform 0.25s var(--pb-ease-out);
}

.history-item.open .history-chevron {
  transform: rotate(180deg);
}

.history-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  gap: 0.75rem;
  margin: 0;
  padding: 0.25rem 0.9rem 1rem;
  list-style: none;
  animation: pb-rise 0.3s var(--pb-ease-out) both;
}

.history-card {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
}

.history-card img {
  width: 100%;
  aspect-ratio: 63 / 88;
  object-fit: cover;
  border-radius: 4px;
}

.history-card-name {
  font-size: 0.72rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.history-chip {
  align-self: flex-start;
  padding: 0.05rem 0.45rem;
  border-radius: 999px;
  border: 1px solid var(--pb-border-strong);
  font-size: 0.6rem;
  font-weight: 800;
  text-transform: uppercase;
}

.history-chip[data-tier='ultra'] {
  color: #0a0d1a;
  border-color: transparent;
  background: var(--pb-holo);
}

.history-empty {
  padding: 2rem;
  border-radius: var(--pb-radius-lg);
  border: 1px dashed var(--pb-border-strong);
  text-align: center;
  color: var(--pb-text-muted);
}

.history-more {
  align-self: center;
}
</style>
