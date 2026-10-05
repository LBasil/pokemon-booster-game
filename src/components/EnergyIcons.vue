<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

// A row of energy symbols (PvP, migration 0031): one colored dot per energy
// (`--pb-type-*`, Colorless included), named for screen readers. `types` is
// an attack's typed cost or a Pokémon's attached energies; without types
// (cards synced before 0031) `count` Colorless dots. An empty cost says
// "free" when `free` is set.
const props = defineProps({
  types: { type: Array, default: () => [] },
  count: { type: Number, default: 0 },
  free: { type: Boolean, default: false },
})

const { t, te } = useI18n()
const typeLabel = (type) => (te(`collection.types.${type}`) ? t(`collection.types.${type}`) : type)
const symbols = computed(() => (props.types?.length ? props.types : Array(Math.max(props.count, 0)).fill('Colorless')))
const label = computed(() => (symbols.value.length ? symbols.value.map(typeLabel).join(', ') : t('pvp.free')))
</script>

<template>
  <span v-if="symbols.length || free" class="energy-icons" role="img" :aria-label="label" :title="label">
    <span v-for="(type, i) in symbols" :key="i" class="energy-dot" :style="{ '--dot': `var(--pb-type-${type.toLowerCase()}, var(--pb-type-colorless))` }"></span>
    <span v-if="!symbols.length" class="energy-free" aria-hidden="true">{{ t('pvp.free') }}</span>
  </span>
</template>

<style scoped>
.energy-icons {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px;
  vertical-align: middle;
}

.energy-dot {
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 50%;
  background: var(--dot);
  border: 1px solid var(--pb-border-strong);
}

.energy-free {
  font-size: 0.7rem;
  color: var(--pb-text-muted);
}
</style>
