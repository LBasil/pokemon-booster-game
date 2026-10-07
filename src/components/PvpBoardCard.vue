<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCardLocale } from '@/composables/useCardLocale'
import { hpPercent } from '@/utils/pvp'
import EnergyIcons from '@/components/EnergyIcons.vue'

// A card on the PvP battle mat or in the hand, like Pokémon TCG Pocket (user,
// 2026-10-07, screenshots of Pocket): the whole card, HP left as a big number
// in its corner with a thin bar, attached energies, special conditions and its
// Tool over the art. The name sits under the image (screen readers, and a
// card whose image doesn't load still says what it is). The sizes follow the
// card's width (container query units), so a Bench card and an Active one
// read the same. PvpCard stays for the deck builder and the detail sheet.
const props = defineProps({
  card: { type: Object, required: true },
  slot: { type: Object, default: null },
})

const { t } = useI18n()
const { cardName, cardImage, fallback } = useCardLocale()
const trainer = computed(() => props.card.stage === 'trainer')
const hpMax = computed(() => props.slot?.hp_max ?? props.card.hp)
const hpLeft = computed(() => props.slot?.hp_left ?? props.card.hp)
const percent = computed(() => hpPercent(hpLeft.value, hpMax.value))
const conditions = computed(() =>
  props.slot ? [props.slot.status, props.slot.poisoned && 'poisoned', props.slot.burned && 'burned'].filter(Boolean) : [],
)
</script>

<template>
  <span class="pbc" :class="{ 'is-trainer': trainer }">
    <span class="pbc-name">{{ cardName(card) }}</span>
    <img class="pbc-img" :src="cardImage(card)" :data-fallback="fallback(card)" alt="" width="245" height="342" loading="lazy" draggable="false" />
    <span
      v-if="slot && !trainer"
      class="pbc-hp"
      :class="{ low: percent <= 30 }"
      role="meter"
      :aria-label="t('pvp.hpLabel')"
      aria-valuemin="0"
      :aria-valuemax="hpMax"
      :aria-valuenow="hpLeft"
    >
      <strong>{{ hpLeft }}</strong>
      <span class="pbc-bar"><span :style="{ width: `${percent}%` }"></span></span>
    </span>
    <span v-if="card.prizes > 1" class="pbc-points">{{ t('pvp.pointsBadge', { count: card.prizes }) }}</span>
    <span v-if="conditions.length" class="pbc-conditions">
      <span v-for="status in conditions" :key="status" class="pbc-condition">{{ t(`pvp.statuses.${status}`) }}</span>
    </span>
    <span v-if="slot?.tool_card" class="pbc-tool">{{ t('pvp.toolOn', { name: cardName(slot.tool_card) }) }}</span>
    <span v-if="slot && slot.energy" class="pbc-energy">
      <EnergyIcons :types="slot.etypes ?? []" :count="slot.energy" />
    </span>
  </span>
</template>

<style scoped>
.pbc {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 245 / 342;
  container-type: inline-size;
  /* the card's own size can't use cqw (they'd measure its parent): 5% of its width */
  border-radius: 5% / 3.6%;
  background: var(--pb-surface);
  box-shadow: var(--pb-shadow-card);
  line-height: 1.15;
  text-align: center;
}

/* Under the image: shows only while it loads or if it fails */
.pbc-name {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 0.2rem;
  border: 1px solid var(--pb-border-strong);
  border-radius: inherit;
  color: var(--pb-text);
  font-size: max(0.55rem, 12cqw);
  font-weight: 800;
  hyphens: auto;
  overflow-wrap: break-word;
}

.pbc-img {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: inherit;
}

/* HP left, big, in the top corner (Pocket) */
.pbc-hp {
  position: absolute;
  top: -6cqw;
  right: -4cqw;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2cqw;
  min-width: 46%;
}

.pbc-hp strong {
  padding: 0 4cqw;
  border-radius: 6cqw;
  background: var(--pb-bg-elevated);
  border: 1px solid var(--pb-border-strong);
  color: var(--pb-text);
  font-family: var(--pb-font-display);
  font-size: max(0.75rem, 17cqw);
  font-weight: 800;
  line-height: 1.1;
  box-shadow: var(--pb-shadow-card);
}

.pbc-bar {
  width: 100%;
  height: max(4px, 5cqw);
  border-radius: 999px;
  background: var(--pb-bg-elevated);
  border: 1px solid var(--pb-border-strong);
  overflow: hidden;
}

.pbc-bar span {
  display: block;
  height: 100%;
  background: var(--pb-success-text);
  transition: width 0.4s var(--pb-ease-out);
}

.pbc-hp.low .pbc-bar span {
  background: var(--pb-danger-text);
}

.pbc-points {
  position: absolute;
  top: 4cqw;
  left: 4cqw;
  padding: 0 4cqw;
  border-radius: 999px;
  background: var(--pb-danger-text);
  color: var(--pb-bg);
  font-size: max(0.55rem, 8cqw);
  font-weight: 800;
}

.pbc-conditions {
  position: absolute;
  left: 3cqw;
  right: 3cqw;
  top: 38%;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 2cqw;
}

.pbc-condition {
  padding: 0 4cqw;
  border-radius: 999px;
  background: var(--pb-danger-text);
  color: var(--pb-bg);
  font-size: max(0.55rem, 8cqw);
  font-weight: 800;
}

.pbc-tool {
  position: absolute;
  left: 3cqw;
  right: 3cqw;
  bottom: 22cqw;
  padding: 0 3cqw;
  border-radius: 4cqw;
  background: var(--pb-bg-elevated);
  color: var(--pb-text);
  font-size: max(0.55rem, 7.5cqw);
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pbc-energy {
  position: absolute;
  left: 3cqw;
  bottom: 3cqw;
  max-width: 94%;
  padding: 2cqw 3cqw;
  border-radius: 999px;
  background: var(--pb-bg-elevated);
  border: 1px solid var(--pb-border-strong);
  line-height: 0;
}

.pbc-energy :deep(.energy-dot) {
  width: max(0.6rem, 12cqw);
  height: max(0.6rem, 12cqw);
}
</style>
