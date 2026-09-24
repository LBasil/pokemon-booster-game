<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { filterEntries, sortEntries } from '@/utils/collection'

// Dialog to pick the profile's showcase card among owned cards, rarest
// first. Emits `select` with a card id, or null for "automatic" (best pull).
const props = defineProps({
  open: { type: Boolean, default: false },
  entries: { type: Array, required: true },
  selectedId: { type: String, default: null },
})

const emit = defineEmits(['select', 'close'])

const { t } = useI18n()
const dialog = ref(null)
const query = ref('')

watch(
  () => props.open,
  async (open) => {
    await nextTick()
    if (open && !dialog.value?.open) {
      query.value = ''
      dialog.value?.showModal()
    }
    if (!open && dialog.value?.open) dialog.value.close()
  },
)

const LIMIT = 60
const options = computed(() => sortEntries(filterEntries(props.entries, { query: query.value }), 'rarity').slice(0, LIMIT))

function pick(cardId) {
  emit('select', cardId)
  dialog.value.close()
}
</script>

<template>
  <dialog ref="dialog" class="showcase-picker" @close="emit('close')" @click.self="dialog.close()">
    <div class="picker-inner">
      <div class="picker-head">
        <h2 class="pb-section-title">{{ t('profile.showcasePickerTitle') }}</h2>
        <button type="button" class="picker-close" :aria-label="t('collection.close')" @click="dialog.close()">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>

      <input
        v-model="query"
        type="search"
        class="form-control"
        :placeholder="t('collection.searchPlaceholder')"
        :aria-label="t('collection.searchLabel')"
      />

      <button type="button" class="picker-auto" :class="{ selected: !selectedId }" @click="pick(null)">
        <span class="picker-auto-icon" aria-hidden="true">
          <svg viewBox="0 0 32 32"><path d="M16 3l3 9.5 9.5 3.5-9.5 3.5L16 29l-3-9.5L3.5 16l9.5-3.5z" /></svg>
        </span>
        <span>
          <span class="picker-auto-title">{{ t('profile.showcaseAuto') }}</span>
          <span class="picker-auto-desc">{{ t('profile.showcaseAutoDesc') }}</span>
        </span>
      </button>

      <ul class="picker-grid" role="list">
        <li v-for="entry in options" :key="entry.card_id">
          <button
            type="button"
            class="picker-card"
            :class="{ selected: entry.card_id === selectedId }"
            :aria-pressed="entry.card_id === selectedId"
            :aria-label="entry.cards.name"
            @click="pick(entry.card_id)"
          >
            <img :src="entry.cards.image_small || entry.cards.image_url" alt="" loading="lazy" />
          </button>
        </li>
      </ul>
      <p v-if="!options.length" class="picker-empty">{{ t('collection.noResults') }}</p>
    </div>
  </dialog>
</template>

<style scoped>
.showcase-picker {
  width: min(720px, calc(100% - 2rem));
  max-width: none;
  max-height: calc(100dvh - 2rem);
  padding: 0;
  border: 1px solid var(--pb-border);
  border-radius: var(--pb-radius-lg);
  background: var(--pb-bg-elevated);
  color: var(--pb-text);
  box-shadow: var(--pb-shadow-lg);
}

.showcase-picker[open] {
  animation: picker-in 0.3s var(--pb-ease-out);
}

.showcase-picker::backdrop {
  background: rgba(5, 7, 15, 0.7);
  backdrop-filter: blur(6px);
}

.picker-inner {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.5rem;
}

.picker-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.picker-close {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid var(--pb-border-strong);
  background: none;
  color: var(--pb-text);
}

.picker-close svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}

.picker-auto {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  padding: 0.75rem;
  border-radius: var(--pb-radius-md);
  border: 1px solid var(--pb-border);
  background: var(--pb-input-bg);
  color: var(--pb-text);
  text-align: left;
}

.picker-auto > span:last-child {
  display: flex;
  flex-direction: column;
}

.picker-auto-icon {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  border-radius: var(--pb-radius-sm);
  background: var(--pb-holo);
}

.picker-auto-icon svg {
  width: 22px;
  fill: #0a0d1a;
}

.picker-auto-title {
  font-weight: 700;
}

.picker-auto-desc {
  font-size: 0.85rem;
  color: var(--pb-text-muted);
}

.picker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
  gap: 0.75rem;
  margin: 0;
  padding: 2px;
  list-style: none;
}

.picker-card {
  display: block;
  width: 100%;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: none;
  transition: transform 0.2s var(--pb-ease-out);
}

.picker-card img {
  display: block;
  width: 100%;
  aspect-ratio: 63 / 88;
  object-fit: cover;
  border-radius: 6px;
  box-shadow: var(--pb-shadow-card);
}

@media (hover: hover) {
  .picker-card:hover {
    transform: translateY(-3px);
  }
}

/* Holo ring on the current choice */
.picker-auto.selected,
.picker-card.selected {
  outline: 3px solid transparent;
  box-shadow:
    0 0 0 3px var(--pb-bg-elevated),
    0 0 0 6px var(--pb-ring);
}

.picker-card.selected {
  border-radius: 6px;
}

.picker-empty {
  margin: 0;
  text-align: center;
  color: var(--pb-text-muted);
}

@keyframes picker-in {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.98);
  }
}
</style>
