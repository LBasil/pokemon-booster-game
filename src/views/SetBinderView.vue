<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { fetchSetCards } from '@/api/cards'
import { useCollectionStore } from '@/stores/collection'
import { useSetsStore } from '@/stores/sets'
import { useWishlistStore } from '@/stores/wishlist'
import { binderSlots, cardNumber } from '@/utils/collection'
import { rarityTier } from '@/utils/rarity'
import { setLogoUrl } from '@/utils/sets'
import AppHeader from '@/components/AppHeader.vue'
import CardDetail from '@/components/CardDetail.vue'
import HoloCard from '@/components/HoloCard.vue'

// A set as a physical binder: every card in collector-number order, owned
// ones in full color, missing ones greyed out in their slot.
const { t, locale } = useI18n()
const route = useRoute()
const collectionStore = useCollectionStore()
const setsStore = useSetsStore()
const wishlist = useWishlistStore()

const setId = computed(() => route.params.setId)
const set = computed(() => setsStore.byId[setId.value] ?? null)

const setCards = ref([])
const loading = ref(true)
const loadError = ref(false)

async function load() {
  loading.value = true
  loadError.value = false
  try {
    setCards.value = await fetchSetCards(setId.value)
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  collectionStore.load()
  setsStore.load()
  wishlist.load()
})
watch(setId, load, { immediate: true })

const slots = computed(() => binderSlots(setCards.value, collectionStore.entries))
const ownedCount = computed(() => slots.value.filter((slot) => slot.quantity > 0).length)
const percent = computed(() => (slots.value.length ? (ownedCount.value / slots.value.length) * 100 : 0))
const formatPercent = (value) => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }).format(value)

const FILTERS = ['all', 'missing', 'owned', 'wanted']
const filter = ref('all')
const visible = computed(() =>
  slots.value.filter((slot) => {
    if (filter.value === 'missing') return slot.quantity === 0
    if (filter.value === 'owned') return slot.quantity > 0
    if (filter.value === 'wanted') return wishlist.has(slot.card.id)
    return true
  }),
)

// Card detail works on binder slots too (quantity 0 = not owned yet)
const openIndex = ref(-1)
const openEntry = computed(() => {
  const slot = visible.value[openIndex.value]
  if (!slot) return null
  const entry = collectionStore.entries.find((e) => e.card_id === slot.card.id)
  return entry ?? { card_id: slot.card.id, quantity: 0, acquired_at: null, cards: slot.card }
})
</script>

<template>
  <div class="pb-page">
    <AppHeader />

    <main class="container binder">
      <RouterLink :to="{ name: 'collection', query: { view: 'sets' } }" class="binder-back">
        <span aria-hidden="true">←</span> {{ t('binder.back') }}
      </RouterLink>

      <header class="binder-head">
        <span class="binder-plate"><img v-if="set" :src="setLogoUrl(set)" alt="" /></span>
        <div class="binder-title-block">
          <h1 class="binder-title">{{ set?.name ?? setId }}</h1>
          <p class="binder-meta">
            <span v-if="set?.release_date">{{ t('boosters.releasedIn', { year: set.release_date.slice(0, 4) }) }} · </span>
            {{ t('binder.progress', { owned: ownedCount, total: slots.length }) }} · {{ formatPercent(percent) }} %
          </p>
          <div class="binder-progress" aria-hidden="true"><span :style="{ width: `${Math.max(percent, 1)}%` }"></span></div>
        </div>
        <RouterLink :to="{ name: 'boosters', query: { set: setId } }" class="btn btn-primary glow-button binder-open">
          {{ t('binder.openThisSet') }}
        </RouterLink>
      </header>

      <div class="binder-chips" role="group" :aria-label="t('binder.filter')">
        <button
          v-for="option in FILTERS"
          :key="option"
          type="button"
          class="binder-chip"
          :class="{ active: filter === option }"
          :aria-pressed="filter === option"
          @click="filter = option"
        >
          {{ t(`binder.filters.${option}`) }}
        </button>
      </div>

      <div v-if="loadError" class="alert alert-danger" role="alert">{{ t('binder.loadError') }}</div>

      <div v-else-if="loading" class="binder-grid">
        <div v-for="n in 18" :key="n" class="pb-skeleton" style="aspect-ratio: 63 / 88"></div>
      </div>

      <p v-else-if="!visible.length" class="binder-empty">{{ t('binder.empty') }}</p>

      <ul v-else class="binder-grid" role="list">
        <li v-for="(slot, index) in visible" :key="slot.card.id">
          <button
            type="button"
            class="binder-slot"
            :class="{ missing: !slot.quantity }"
            :data-tier="rarityTier(slot.card)"
            :aria-label="slot.quantity ? slot.card.name : t('binder.missingCard', { number: cardNumber(slot.card.id), name: slot.card.name })"
            @click="openIndex = index"
          >
            <span class="binder-img">
              <HoloCard v-if="slot.quantity" :src="slot.card.image_small || slot.card.image_url" alt="" :max-tilt="8" />
              <img v-else :src="slot.card.image_small || slot.card.image_url" alt="" loading="lazy" />
              <span v-if="slot.quantity > 1" class="binder-qty">x{{ slot.quantity }}</span>
              <span v-if="wishlist.has(slot.card.id)" class="binder-wish" :title="t('binder.wanted')">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" /></svg>
              </span>
            </span>
            <span class="binder-number">{{ cardNumber(slot.card.id) }}</span>
          </button>
        </li>
      </ul>
    </main>

    <CardDetail
      :entry="openEntry"
      :set="set"
      :has-prev="openIndex > 0"
      :has-next="openIndex < visible.length - 1"
      @prev="openIndex--"
      @next="openIndex++"
      @close="openIndex = -1"
    />
  </div>
</template>

<style scoped>
.binder {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding-top: 1rem;
}

.binder-back {
  align-self: flex-start;
  font-weight: 700;
  color: var(--pb-text-muted);
}

.binder-back:hover {
  color: var(--pb-text);
}

.binder-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem 1.5rem;
  padding: 1.25rem;
  border-radius: var(--pb-radius-lg);
  border: 1px solid var(--pb-border);
  background: var(--pb-surface);
  animation: pb-rise 0.5s var(--pb-ease-out) both;
}

/* Logos are drawn for dark packaging: dark plate in both themes */
.binder-plate {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 120px;
  height: 64px;
  padding: 8px 10px;
  border-radius: var(--pb-radius-md);
  background: linear-gradient(160deg, #1d2450, #0a0d1a);
}

.binder-plate img {
  max-width: 100px;
  max-height: 48px;
  object-fit: contain;
}

.binder-title-block {
  flex: 1;
  min-width: 220px;
}

.binder-title {
  margin: 0;
  font-size: clamp(1.5rem, 4vw, 2.2rem);
  font-weight: 800;
}

.binder-meta {
  margin: 0.3rem 0 0.6rem;
  color: var(--pb-text-muted);
  font-weight: 600;
}

.binder-progress {
  height: 8px;
  border-radius: 999px;
  background: var(--pb-input-bg);
  border: 1px solid var(--pb-border);
  overflow: hidden;
}

.binder-progress span {
  display: block;
  height: 100%;
  background: var(--pb-holo);
  border-radius: inherit;
}

.binder-chips {
  display: flex;
  gap: 0.4rem;
  overflow-x: auto;
  scrollbar-width: none;
}

.binder-chip {
  flex-shrink: 0;
  padding: 0.4rem 0.9rem;
  border-radius: 999px;
  border: 1px solid var(--pb-border-strong);
  background: var(--pb-surface);
  color: var(--pb-text-muted);
  font-size: 0.85rem;
  font-weight: 700;
}

.binder-chip.active {
  background: var(--pb-text);
  border-color: var(--pb-text);
  color: var(--pb-bg);
}

.binder-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 1rem 0.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.binder-slot {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  width: 100%;
  padding: 0;
  border: none;
  background: none;
  color: var(--pb-text);
  border-radius: var(--pb-radius-sm);
}

.binder-img {
  position: relative;
  display: block;
  aspect-ratio: 63 / 88;
}

.binder-img > img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 4.5% / 3.2%;
}

/* Empty slot: the card shows as a faded ghost in its sleeve */
.binder-slot.missing .binder-img {
  border-radius: 4.5% / 3.2%;
  outline: 1px dashed var(--pb-border-strong);
  outline-offset: 3px;
}

.binder-slot.missing .binder-img > img {
  filter: grayscale(1);
  opacity: 0.22;
  transition: opacity 0.2s;
}

@media (hover: hover) {
  .binder-slot.missing:hover .binder-img > img {
    opacity: 0.5;
  }
}

.binder-qty {
  position: absolute;
  top: 5px;
  right: 5px;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(10, 13, 26, 0.85);
  color: #fff;
  font-size: 0.7rem;
  font-weight: 800;
}

.binder-wish {
  position: absolute;
  bottom: 6px;
  right: 6px;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--pb-bg-elevated);
  color: var(--pb-ring);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
}

.binder-wish svg {
  width: 15px;
  height: 15px;
  fill: currentColor;
}

.binder-number {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--pb-text-muted);
  text-align: center;
  font-variant-numeric: tabular-nums;
}

.binder-empty {
  padding: 2rem 0;
  text-align: center;
  color: var(--pb-text-muted);
}

@media (min-width: 768px) {
  .binder-grid {
    grid-template-columns: repeat(auto-fill, minmax(128px, 1fr));
  }
}
</style>
