<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

// A coin amount for the challenge mode: coin icon + localized number.
// Screen readers get the unit spelled out ("1,200 coins").
const props = defineProps({
  amount: { type: Number, required: true },
  // Shows "+200" for rewards
  signed: { type: Boolean, default: false },
})

const { t, locale } = useI18n()
const formatted = computed(() => {
  const number = Math.abs(props.amount).toLocaleString(locale.value)
  if (!props.signed) return number
  return `${props.amount < 0 ? '−' : '+'}${number}`
})
</script>

<template>
  <span class="coin-amount">
    <svg class="coin-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 7.5l1.3 3.2 3.2 1.3-3.2 1.3L12 16.5l-1.3-3.2L7.5 12l3.2-1.3z" />
    </svg>
    <span aria-hidden="true">{{ formatted }}</span>
    <span class="visually-hidden">{{ t('challenge.coins', { count: formatted }, Math.abs(amount)) }}</span>
  </span>
</template>

<style scoped>
.coin-amount {
  display: inline-flex;
  align-items: center;
  gap: 0.3em;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.coin-icon {
  width: 1.05em;
  height: 1.05em;
  flex-shrink: 0;
}

.coin-icon circle {
  fill: var(--pb-accent);
  stroke: var(--pb-coin-edge);
  stroke-width: 1.6;
}

.coin-icon path {
  fill: var(--pb-coin-edge);
}
</style>
