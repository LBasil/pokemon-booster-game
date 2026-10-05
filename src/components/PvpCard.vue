<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCardLocale } from '@/composables/useCardLocale'
import { attackName, damageLabel, hpPercent } from '@/utils/pvp'

// One card in a PvP battle or deck (a pvp_card() snapshot, migration 0030),
// in the player's language. In play (`slot`: damage, energy, special
// conditions, hp_left) it shows its HP bar, energies and conditions;
// otherwise its printed HP and stage. `compact` (the board) leaves the
// attacks to the detail sheet (PvpCardSheet).
const props = defineProps({
  card: { type: Object, required: true },
  slot: { type: Object, default: null },
  compact: { type: Boolean, default: false },
})

const { t, te } = useI18n()
const { french, cardName, cardImage, fallback } = useCardLocale()
const typeLabel = (type) => (te(`collection.types.${type}`) ? t(`collection.types.${type}`) : type)
const hpLeft = computed(() => props.slot?.hp_left ?? props.card.hp)
const percent = computed(() => hpPercent(hpLeft.value, props.card.hp))
const conditions = computed(() =>
  props.slot ? [props.slot.status, props.slot.poisoned && 'poisoned', props.slot.burned && 'burned'].filter(Boolean) : [],
)
</script>

<template>
  <div class="pvp-card" :class="{ compact }">
    <span class="pvp-img-wrap">
      <img class="pvp-img" :src="cardImage(card)" :data-fallback="fallback(card)" alt="" width="245" height="342" loading="lazy" draggable="false" />
      <span v-if="card.prizes > 1" class="pvp-points">{{ t('pvp.pointsBadge', { count: card.prizes }) }}</span>
      <span v-if="slot && slot.energy" class="pvp-energy" :title="t('pvp.energyCount', { count: slot.energy }, slot.energy)">
        <span aria-hidden="true">⚡</span>{{ slot.energy }}
        <span class="visually-hidden">{{ t('pvp.energyCount', { count: slot.energy }, slot.energy) }}</span>
      </span>
    </span>
    <span class="pvp-name">{{ cardName(card) }}</span>
    <span v-if="slot" class="pvp-hp" role="meter" :aria-label="t('pvp.hpLabel')" aria-valuemin="0" :aria-valuemax="card.hp" :aria-valuenow="hpLeft">
      <span class="pvp-hp-bar" :class="{ low: percent <= 30 }"><span :style="{ width: `${percent}%` }"></span></span>
      <span class="pvp-hp-text">{{ t('pvp.hp', { left: hpLeft, hp: card.hp }) }}</span>
    </span>
    <span v-else class="pvp-hp-text">
      {{ t('pvp.hpPrinted', { hp: card.hp }) }} ·
      {{ card.stage === 'evolution' ? t('pvp.stage.evolution', { name: card.evolves_from }) : t(`pvp.stage.${card.stage}`) }}
    </span>
    <span v-if="conditions.length" class="pvp-conditions">
      <span v-for="status in conditions" :key="status" class="pvp-condition" :class="`is-${status}`">{{ t(`pvp.statuses.${status}`) }}</span>
    </span>
    <ul v-if="!compact" class="pvp-attacks" :aria-label="t('pvp.attacks')">
      <li v-for="(attack, i) in card.attacks" :key="i" :class="{ unusable: !attack.usable }">
        <span class="pvp-cost" :aria-label="t('pvp.attackCost', { count: attack.cost }, attack.cost)">{{ attack.cost }}</span>
        <span class="pvp-attack-name">{{ attackName(attack, french) }}</span>
        <strong>{{ damageLabel(attack) }}</strong>
      </li>
    </ul>
    <span v-if="!compact" class="pvp-types">
      <span v-for="type in card.types" :key="type" class="pvp-dot" :style="{ '--dot': `var(--pb-type-${type.toLowerCase()}, var(--pb-type-colorless))` }" :title="typeLabel(type)"></span>
      <span v-if="card.weaknesses?.length" class="pvp-weak">{{ t('pvp.weakTo', { types: card.weaknesses.map(typeLabel).join(', ') }) }}</span>
    </span>
  </div>
</template>

<style scoped>
.pvp-card {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
  height: 100%;
  font-size: 0.75rem;
  text-align: left;
}

.pvp-img-wrap {
  position: relative;
  display: block;
}

.pvp-img {
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 245 / 342;
  object-fit: cover;
  border-radius: 6px;
}

.pvp-points,
.pvp-energy {
  position: absolute;
  padding: 0.05rem 0.4rem;
  border-radius: 999px;
  font-size: 0.68rem;
  font-weight: 800;
  line-height: 1.4;
}

.pvp-points {
  top: 0.25rem;
  right: 0.25rem;
  background: var(--pb-danger-text);
  color: var(--pb-bg);
}

.pvp-energy {
  bottom: 0.25rem;
  left: 0.25rem;
  background: var(--pb-accent);
  color: var(--pb-accent-ink);
}

.pvp-name {
  font-weight: 800;
  font-size: 0.8rem;
  line-height: 1.2;
  overflow-wrap: anywhere;
}

.compact .pvp-name {
  font-size: 0.72rem;
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
  overflow-wrap: anywhere;
}

.pvp-conditions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.2rem;
}

.pvp-condition {
  padding: 0 0.35rem;
  border-radius: 999px;
  background: var(--pb-danger-bg);
  color: var(--pb-danger-text);
  font-size: 0.65rem;
  font-weight: 800;
}

.pvp-attacks {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.pvp-attacks li {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  min-width: 0;
}

.pvp-attacks li.unusable {
  opacity: 0.55;
}

.pvp-attacks strong {
  margin-left: auto;
}

/* Energy cost: a small coin with the number of energies */
.pvp-cost {
  flex: none;
  display: grid;
  place-items: center;
  width: 1.05rem;
  height: 1.05rem;
  border-radius: 50%;
  border: 1px solid var(--pb-border-strong);
  background: var(--pb-input-bg);
  font-size: 0.65rem;
  font-weight: 800;
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
</style>
