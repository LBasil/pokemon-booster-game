<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { boosterSets, groupSetsByYear, setLogoUrl, subsetsOf } from '@/utils/sets'

// Searchable grid of sets grouped by year, plus the "any set" option.
// v-model is the selected set id ('' = any set). Subsets aren't listed: they
// come inside their parent's packs, whose option says so.
const props = defineProps({
  sets: { type: Array, required: true },
  loading: { type: Boolean, default: false },
})

const selected = defineModel({ type: String, default: '' })

const { t } = useI18n()
const query = ref('')
const groups = computed(() => groupSetsByYear(boosterSets(props.sets), query.value))
const bonusCards = (set) => subsetsOf(set.id, props.sets).reduce((sum, subset) => sum + (subset.total ?? 0), 0)

// Logos missing on the CDN fall back to the set name
const brokenLogos = ref(new Set())
function onLogoError(setId) {
  brokenLogos.value = new Set(brokenLogos.value).add(setId)
}
</script>

<template>
  <div class="set-picker">
    <div class="set-picker-search">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4" /></svg>
      <input
        v-model="query"
        type="search"
        class="form-control"
        :placeholder="t('boosters.searchPlaceholder')"
        :aria-label="t('boosters.searchLabel')"
      />
    </div>

    <div class="set-picker-list" role="radiogroup" :aria-label="t('boosters.setLabel')">
      <button
        v-if="!query"
        type="button"
        role="radio"
        class="set-option set-option-any"
        :class="{ selected: selected === '' }"
        :aria-checked="selected === ''"
        @click="selected = ''"
      >
        <span class="set-option-plate">
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <path d="M16 3l3 9.5 9.5 3.5-9.5 3.5L16 29l-3-9.5L3.5 16l9.5-3.5z" />
          </svg>
        </span>
        <span class="set-option-text">
          <span class="set-option-name">{{ t('boosters.anySet') }}</span>
          <span class="set-option-meta">{{ t('boosters.anySetDesc') }}</span>
        </span>
      </button>

      <template v-if="loading">
        <div v-for="n in 6" :key="n" class="pb-skeleton" style="height: 64px"></div>
      </template>

      <p v-else-if="groups.length === 0" class="set-picker-empty">{{ t('boosters.noResults') }}</p>

      <section v-for="group in groups" :key="group.year ?? 'undated'" class="set-group">
        <h3 class="set-group-year">{{ group.year ?? t('boosters.undated') }}</h3>
        <button
          v-for="set in group.sets"
          :key="set.id"
          type="button"
          role="radio"
          class="set-option"
          :class="{ selected: selected === set.id }"
          :aria-checked="selected === set.id"
          @click="selected = set.id"
        >
          <span class="set-option-plate">
            <img
              v-if="!brokenLogos.has(set.id)"
              :src="setLogoUrl(set)"
              alt=""
              loading="lazy"
              decoding="async"
              @error="onLogoError(set.id)"
            />
          </span>
          <span class="set-option-text">
            <span class="set-option-name">{{ set.name }}</span>
            <span v-if="set.total" class="set-option-meta">
              {{ t('boosters.cardCount', { count: set.total }) }}<template v-if="bonusCards(set)"> · {{ t('boosters.bonusCards', { count: bonusCards(set) }) }}</template>
            </span>
          </span>
        </button>
      </section>
    </div>
  </div>
</template>

<style scoped>
.set-picker {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-height: 0;
}

.set-picker-search {
  position: relative;
}

.set-picker-search svg {
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

.set-picker-search .form-control {
  padding-left: 2.6rem;
}

.set-picker-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-height: 0;
  overflow-y: auto;
  padding: 2px 4px 4px 2px;
  scrollbar-width: thin;
}

.set-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.set-group-year {
  position: sticky;
  top: 0;
  z-index: 1;
  margin: 0.75rem 0 0;
  padding: 0.25rem 0;
  font-family: var(--pb-font-body);
  font-size: 0.8rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: var(--pb-text-muted);
  background: var(--pb-bg-elevated);
}

.set-option {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  width: 100%;
  padding: 0.5rem;
  border-radius: var(--pb-radius-md);
  border: 1px solid var(--pb-border);
  background: var(--pb-input-bg);
  color: var(--pb-text);
  text-align: left;
  transition:
    border-color 0.2s,
    background-color 0.2s;
}

.set-option:hover {
  border-color: var(--pb-border-strong);
  background: var(--pb-surface-hover);
}

.set-option.selected {
  border-color: transparent;
  background:
    linear-gradient(var(--pb-bg-elevated), var(--pb-bg-elevated)) padding-box,
    var(--pb-holo) border-box;
  border: 2px solid transparent;
  padding: calc(0.5rem - 1px);
}

/* Logos are drawn for dark packaging, so they sit on a dark plate in both themes */
.set-option-plate {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 92px;
  height: 48px;
  padding: 6px 8px;
  border-radius: var(--pb-radius-sm);
  background: linear-gradient(160deg, #1d2450, #0a0d1a);
}

.set-option-plate img {
  max-width: 76px;
  max-height: 36px;
  object-fit: contain;
}

.set-option-plate svg {
  width: 26px;
  fill: #fcd34d;
}

.set-option-any .set-option-plate {
  background: var(--pb-holo);
}

.set-option-any .set-option-plate svg {
  fill: #0a0d1a;
}

.set-option-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.set-option-name {
  font-weight: 700;
  font-size: 0.95rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.set-option-meta {
  font-size: 0.8rem;
  color: var(--pb-text-muted);
}

.set-picker-empty {
  margin: 1rem 0;
  text-align: center;
  color: var(--pb-text-muted);
}
</style>
