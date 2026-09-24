<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { fetchCardsByIds } from '@/api/cards'
import { fetchOpenings } from '@/api/history'
import { useSetsStore } from '@/stores/sets'
import { rarityLabelKey, rarityTier, sortForReveal } from '@/utils/rarity'
import { setLogoUrl } from '@/utils/sets'
import AppHeader from '@/components/AppHeader.vue'

// Past boosters, newest first, 20 at a time. Each row expands to show its
// 10 cards (fetched once, then cached).
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
    const page = await fetchOpenings({ before: openings.value.at(-1)?.opened_at, limit: PAGE })
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

onMounted(() => {
  setsStore.load()
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
        <span class="pb-eyebrow">{{ t('history.eyebrow') }}</span>
        <h1 class="history-title">{{ t('history.title') }}</h1>
        <p class="pb-muted">{{ t('history.subtitle') }}</p>
      </header>

      <div v-if="loadError && !openings.length" class="alert alert-danger" role="alert">{{ t('history.loadError') }}</div>

      <div v-else-if="!openings.length && loading" class="history-list">
        <div v-for="n in 5" :key="n" class="pb-skeleton" style="height: 76px"></div>
      </div>

      <div v-else-if="!openings.length" class="history-empty">
        <p>{{ t('history.empty') }}</p>
        <RouterLink :to="{ name: 'boosters' }" class="btn btn-primary glow-button">{{ t('game.openCta') }}</RouterLink>
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

.history-title {
  margin: 1rem 0 0.5rem;
  font-size: clamp(1.8rem, 5vw, 2.6rem);
  font-weight: 800;
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
