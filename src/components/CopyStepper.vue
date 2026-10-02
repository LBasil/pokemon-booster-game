<script setup>
import { useI18n } from 'vue-i18n'

// − n/max +: how many copies of a card (recycling some duplicates, not all).
// `name` = the card's name, for the buttons' labels.
const props = defineProps({
  modelValue: { type: Number, required: true },
  max: { type: Number, required: true },
  min: { type: Number, default: 0 },
  name: { type: String, required: true },
})
const emit = defineEmits(['update:modelValue'])

const { t } = useI18n()
const set = (value) => emit('update:modelValue', Math.min(Math.max(value, props.min), props.max))
</script>

<template>
  <div class="stepper">
    <button
      type="button"
      class="stepper-btn"
      :disabled="modelValue <= min"
      :aria-label="t('challenge.pick.less', { name })"
      @click="set(modelValue - 1)"
    >
      −
    </button>
    <span class="stepper-value">{{ t('challenge.pick.copies', { count: modelValue, total: max }) }}</span>
    <button
      type="button"
      class="stepper-btn"
      :disabled="modelValue >= max"
      :aria-label="t('challenge.pick.more', { name })"
      @click="set(modelValue + 1)"
    >
      +
    </button>
  </div>
</template>

<style scoped>
.stepper {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  border: 1px solid var(--pb-border-strong);
  border-radius: 999px;
  background: var(--pb-surface);
}

.stepper-btn {
  width: 2rem;
  height: 2rem;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--pb-text);
  font-size: 1.05rem;
  font-weight: 700;
  line-height: 1;
}

.stepper-btn:disabled {
  color: var(--pb-text-muted);
  opacity: 0.5;
}

@media (hover: hover) {
  .stepper-btn:not(:disabled):hover {
    background: var(--pb-selected);
  }
}

.stepper-value {
  min-width: 2.6rem;
  text-align: center;
  font-size: 0.82rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
</style>
