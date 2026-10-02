<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { setProgress } from '@/utils/collection'

// A goal a beginner can reach: the most advanced set ("151: 10 / 165"),
// next to the whole-pool progress (0.1% of 20,670 cards on day one only
// discouraged). Renders nothing until a card is owned. `to` makes the set
// name a link (e.g. its binder); leave it out inside a link (hub tile).
const props = defineProps({
  entries: { type: Array, required: true },
  sets: { type: Array, required: true },
  to: { type: Function, default: null }, // set id -> route location
})

const { t, locale } = useI18n()
const best = computed(() => (props.entries.length ? (setProgress(props.entries, props.sets)[0] ?? null) : null))
const percentLabel = computed(() =>
  best.value ? new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }).format(Math.floor(best.value.percent * 10) / 10) : '',
)
</script>

<template>
  <div v-if="best" class="set-goal">
    <p class="set-goal-text">
      <span class="set-goal-label">{{ t('collection.goalLabel') }}</span>
      <RouterLink v-if="to" :to="to(best.set.id)" class="set-goal-name">{{ best.set.name }}</RouterLink>
      <strong v-else class="set-goal-name">{{ best.set.name }}</strong>
      <span class="set-goal-count">{{ t('collection.goalCount', { owned: best.owned, total: best.total, percent: percentLabel }) }}</span>
    </p>
    <div
      class="set-goal-bar"
      role="progressbar"
      :aria-label="t('collection.goalAria', { name: best.set.name })"
      aria-valuemin="0"
      :aria-valuemax="best.total"
      :aria-valuenow="best.owned"
    >
      <span :style="{ width: `${Math.max(best.percent, 2)}%` }"></span>
    </div>
  </div>
</template>

<style scoped>
.set-goal {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin-top: 0.75rem;
}

.set-goal-text {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 0.4rem;
  margin: 0;
  font-size: 0.9rem;
}

.set-goal-label {
  color: var(--pb-text-muted);
}

.set-goal-name {
  font-weight: 800;
}

.set-goal-count {
  color: var(--pb-text-muted);
  font-weight: 600;
}

.set-goal-bar {
  height: 6px;
  border-radius: 999px;
  background: var(--pb-border);
  overflow: hidden;
}

.set-goal-bar span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--pb-holo);
}
</style>
