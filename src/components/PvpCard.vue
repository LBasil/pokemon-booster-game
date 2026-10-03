<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { damageLabel, hpPercent } from '@/utils/pvp'

// One card in a PvP battle or deck (a pvp_card() snapshot): picture, HP
// left (bar), best attack and weakness. `hidden` = a defender card not
// played yet (a card back).
const props = defineProps({
  card: { type: Object, default: null },
  hidden: { type: Boolean, default: false },
  // Show the HP bar (battles); decks only show the printed HP
  showHp: { type: Boolean, default: false },
})

const { t, te } = useI18n()
const typeLabel = (type) => (te(`collection.types.${type}`) ? t(`collection.types.${type}`) : type)
const knockedOut = computed(() => props.showHp && props.card?.hp_left === 0)
const percent = computed(() => (props.card ? hpPercent(props.card) : 0))
</script>

<template>
  <div v-if="hidden || !card" class="pvp-card is-hidden" :aria-label="t('pvp.hiddenCard')" role="img">
    <span class="pvp-back" aria-hidden="true">?</span>
  </div>
  <div v-else class="pvp-card" :class="{ 'is-ko': knockedOut }">
    <img class="pvp-img" :src="card.image_small" alt="" width="245" height="342" loading="lazy" draggable="false" />
    <span class="pvp-name">{{ card.name }}</span>
    <span v-if="showHp" class="pvp-hp" role="meter" :aria-label="t('pvp.hpLabel')" aria-valuemin="0" :aria-valuemax="card.hp" :aria-valuenow="card.hp_left">
      <span class="pvp-hp-bar" :class="{ low: percent <= 30 }"><span :style="{ width: `${percent}%` }"></span></span>
      <span class="pvp-hp-text">{{ knockedOut ? t('pvp.ko') : t('pvp.hp', { left: card.hp_left, hp: card.hp }) }}</span>
    </span>
    <span v-else class="pvp-hp-text">{{ t('pvp.hpPrinted', { hp: card.hp }) }}</span>
    <span class="pvp-attack">
      <span class="pvp-attack-name">{{ card.attack }}</span>
      <strong>{{ damageLabel(card) }}</strong>
    </span>
    <span class="pvp-types">
      <span v-for="type in card.types" :key="type" class="pvp-dot" :style="{ '--dot': `var(--pb-type-${type.toLowerCase()}, var(--pb-type-colorless))` }" :title="typeLabel(type)"></span>
      <span v-if="card.weaknesses?.length" class="pvp-weak">{{ t('pvp.weakTo', { types: card.weaknesses.map(typeLabel).join(', ') }) }}</span>
    </span>
  </div>
</template>

<style scoped>
.pvp-card {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-width: 0;
  height: 100%;
  font-size: 0.75rem;
  text-align: left;
}

.pvp-img {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 6px;
}

.pvp-name {
  font-weight: 800;
  font-size: 0.8rem;
  line-height: 1.2;
  overflow-wrap: anywhere;
}

.pvp-hp {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.pvp-hp-bar {
  height: 6px;
  border-radius: 999px;
  background: var(--pb-border);
  overflow: hidden;
}

.pvp-hp-bar span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--pb-success-text);
  transition: width 0.4s var(--pb-ease-out);
}

.pvp-hp-bar.low span {
  background: var(--pb-danger-text);
}

.pvp-hp-text {
  color: var(--pb-text-muted);
  font-weight: 700;
}

.pvp-attack {
  display: flex;
  justify-content: space-between;
  gap: 0.35rem;
  min-width: 0;
}

.pvp-attack-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pvp-types {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem;
  color: var(--pb-text-muted);
}

.pvp-dot {
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 50%;
  background: var(--dot);
  border: 1px solid var(--pb-border-strong);
}

.pvp-weak {
  font-size: 0.7rem;
}

.pvp-card.is-ko {
  opacity: 0.45;
}

.pvp-card.is-ko .pvp-img {
  filter: grayscale(1);
}

.pvp-card.is-hidden {
  display: grid;
  place-items: center;
  aspect-ratio: 245 / 342;
  height: auto;
  border-radius: 6px;
  border: 2px dashed var(--pb-border-strong);
  background: var(--pb-bg-elevated);
}

.pvp-back {
  font-family: var(--pb-font-display);
  font-size: 1.6rem;
  font-weight: 800;
  color: var(--pb-text-muted);
}

@media (prefers-reduced-motion: reduce) {
  .pvp-hp-bar span {
    transition: none;
  }
}
</style>
