<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { fetchPokedexSize } from '@/api/cards'
import { pokedexSlots } from '@/utils/collection'

// National Pokédex view of the collection: one slot per species, owned ones
// with their sprite, others as silhouettes. Picking an owned slot emits its
// number (the collection then filters to that Pokémon's cards).
const props = defineProps({
  entries: { type: Array, required: true },
})

const emit = defineEmits(['select'])

const { t, locale } = useI18n()

// Sprites from the public PokéAPI repository (tiny PNGs, CORS-enabled)
const spriteUrl = (number) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${number}.png`

const size = ref(cachedSize)
onMounted(async () => {
  if (!size.value) {
    try {
      cachedSize = await fetchPokedexSize()
    } catch {
      cachedSize = 1025
    }
    size.value = cachedSize
  }
})

const slots = computed(() => pokedexSlots(props.entries, size.value))
const caught = computed(() => slots.value.filter((slot) => slot.owned).length)
const percent = computed(() => (size.value ? (caught.value / size.value) * 100 : 0))

const FILTERS = ['all', 'caught', 'missing']
const filter = ref('all')
const visible = computed(() =>
  slots.value.filter((slot) => (filter.value === 'caught' ? slot.owned : filter.value === 'missing' ? !slot.owned : true)),
)

// 1,000+ slots: render progressively as the user scrolls
const PAGE = 120
const shown = ref(PAGE)
watch(visible, () => (shown.value = PAGE))
const sentinel = ref(null)
let observer = null
onMounted(() => {
  observer = new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting) shown.value += PAGE
  }, { rootMargin: '800px' })
})
watch(sentinel, (el, old) => {
  if (old) observer?.unobserve(old)
  if (el) observer?.observe(el)
})
onBeforeUnmount(() => observer?.disconnect())

const pad = (number) => String(number).padStart(4, '0')
const formatNumber = (value) => value.toLocaleString(locale.value)
</script>

<script>
// Pokédex size rarely changes: fetched once per visit, shared by instances
let cachedSize = 0
</script>

<template>
  <section class="dex">
    <div class="dex-head">
      <p class="dex-count">
        <strong>{{ formatNumber(caught) }}</strong> / {{ formatNumber(size) }}
        <span class="pb-muted">{{ t('pokedex.caught') }}</span>
      </p>
      <div class="dex-progress" aria-hidden="true"><span :style="{ width: `${Math.max(percent, 1)}%` }"></span></div>
    </div>

    <div class="dex-chips" role="group" :aria-label="t('pokedex.filter')">
      <button
        v-for="option in FILTERS"
        :key="option"
        type="button"
        class="dex-chip"
        :class="{ active: filter === option }"
        :aria-pressed="filter === option"
        @click="filter = option"
      >
        {{ t(`pokedex.filters.${option}`) }}
      </button>
    </div>

    <ul class="dex-grid" role="list">
      <li v-for="slot in visible.slice(0, shown)" :key="slot.number">
        <button
          type="button"
          class="dex-slot"
          :class="{ owned: slot.owned }"
          :disabled="!slot.owned"
          :aria-label="slot.owned ? t('pokedex.showCards', { name: slot.name, count: slot.owned }, slot.owned) : t('pokedex.unknown', { number: pad(slot.number) })"
          @click="emit('select', slot.number)"
        >
          <img :src="spriteUrl(slot.number)" alt="" loading="lazy" width="72" height="72" />
          <span class="dex-number">#{{ pad(slot.number) }}</span>
          <span class="dex-name">{{ slot.owned ? slot.name : '???' }}</span>
        </button>
      </li>
    </ul>
    <div v-if="shown < visible.length" ref="sentinel" aria-hidden="true" style="height: 1px"></div>
  </section>
</template>

<style scoped>
.dex {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.dex-count {
  margin: 0 0 0.5rem;
  font-size: 1.1rem;
}

.dex-count strong {
  font-family: var(--pb-font-display);
  font-size: 1.6rem;
}

.dex-progress {
  height: 8px;
  border-radius: 999px;
  background: var(--pb-input-bg);
  border: 1px solid var(--pb-border);
  overflow: hidden;
}

.dex-progress span {
  display: block;
  height: 100%;
  background: var(--pb-holo);
  border-radius: inherit;
}

.dex-chips {
  display: flex;
  gap: 0.4rem;
}

.dex-chip {
  padding: 0.4rem 0.9rem;
  border-radius: 999px;
  border: 1px solid var(--pb-border-strong);
  background: var(--pb-surface);
  color: var(--pb-text-muted);
  font-size: 0.85rem;
  font-weight: 700;
}

.dex-chip.active {
  background: var(--pb-text);
  border-color: var(--pb-text);
  color: var(--pb-bg);
}

.dex-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 0.6rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.dex-slot {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  padding: 0.5rem 0.25rem 0.6rem;
  border-radius: var(--pb-radius-md);
  border: 1px solid var(--pb-border);
  background: var(--pb-input-bg);
  color: var(--pb-text-muted);
}

.dex-slot img {
  width: 72px;
  height: 72px;
  image-rendering: pixelated;
  /* Uncaught: a silhouette, like the games */
  filter: brightness(0);
  opacity: 0.18;
}

[data-bs-theme='light'] .dex-slot img {
  opacity: 0.12;
}

.dex-slot.owned {
  color: var(--pb-text);
  border-color: var(--pb-border-strong);
  background: var(--pb-surface);
  transition: transform 0.2s var(--pb-ease-out);
}

.dex-slot.owned img {
  filter: none;
  opacity: 1;
}

@media (hover: hover) {
  .dex-slot.owned:hover {
    transform: translateY(-2px);
  }
}

.dex-number {
  font-size: 0.7rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--pb-text-muted);
}

.dex-name {
  max-width: 100%;
  padding: 0 0.25rem;
  font-size: 0.78rem;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
