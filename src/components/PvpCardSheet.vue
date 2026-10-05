<script setup>
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCardLocale } from '@/composables/useCardLocale'
import { attackName, attackText, damageLabel } from '@/utils/pvp'
import EnergyIcons from '@/components/EnergyIcons.vue'
import PvpCard from '@/components/PvpCard.vue'

// A PvP card read in full (migration 0030): its attacks with their cost,
// damage and text (French when imported, 0029), what the battles don't play
// of it, its abilities (not played yet), weakness, resistance and retreat.
// A Trainer (0032): its kind, its text and how that kind is played.
// Abilities (0033): how each one is played, or "not played yet".
// `card` null = closed.
const props = defineProps({
  card: { type: Object, default: null },
  slot: { type: Object, default: null },
})
const emit = defineEmits(['close'])

const { t, te } = useI18n()
const { french, cardName } = useCardLocale()
const dialog = ref(null)
const typeLabel = (type) => (te(`collection.types.${type}`) ? t(`collection.types.${type}`) : type)

watch(
  () => props.card,
  async (card) => {
    await nextTick()
    if (card && !dialog.value?.open) dialog.value?.showModal()
    if (!card && dialog.value?.open) dialog.value.close()
  },
  { immediate: true },
)
</script>

<template>
  <dialog ref="dialog" class="pvp-sheet" :aria-label="card ? cardName(card) : ''" @close="emit('close')" @click.self="dialog.close()">
    <div v-if="card" class="pvp-sheet-inner">
      <button type="button" class="pvp-sheet-close" :aria-label="t('pvp.close')" @click="dialog.close()">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
      <div class="pvp-sheet-card"><PvpCard :card="card" :slot="slot" compact /></div>
      <div class="pvp-sheet-text">
        <h2 class="pvp-sheet-name">{{ cardName(card) }}</h2>
        <template v-if="card.stage === 'trainer'">
          <p class="pvp-sheet-kind">{{ t(`pvp.trainerKinds.${card.kind}`) }}<template v-if="card.ace_spec"> · {{ t('pvp.aceSpec') }}</template></p>
          <p class="pvp-sheet-effect pvp-sheet-trainer">{{ attackText(card, french) }}</p>
          <p class="pvp-sheet-note">{{ t(`pvp.trainerHow.${card.kind}`) }}</p>
        </template>
        <dl v-else class="pvp-sheet-facts">
          <div>
            <dt>{{ t('pvp.weakness') }}</dt>
            <dd>{{ card.weaknesses?.length ? card.weaknesses.map(typeLabel).join(', ') : '-' }}</dd>
          </div>
          <div>
            <dt>{{ t('pvp.resistance') }}</dt>
            <dd>{{ card.resistances?.length ? card.resistances.map(typeLabel).join(', ') : '-' }}</dd>
          </div>
          <div>
            <dt>{{ t('pvp.retreatCost') }}</dt>
            <dd>{{ t('pvp.energyCount', { count: card.retreat }, card.retreat) }}</dd>
          </div>
        </dl>

        <h3 v-if="card.stage !== 'trainer'" class="pvp-sheet-title">{{ t('pvp.attacks') }}</h3>
        <ul v-if="card.stage !== 'trainer'" class="pvp-sheet-attacks">
          <li v-for="(attack, i) in card.attacks" :key="i">
            <p class="pvp-sheet-attack">
              <EnergyIcons class="pvp-sheet-cost" :types="attack.energy ?? []" :count="attack.cost" free />
              <strong>{{ attackName(attack, french) }}</strong>
              <strong class="pvp-sheet-damage">{{ damageLabel(attack) }}</strong>
            </p>
            <p v-if="attackText(attack, french)" class="pvp-sheet-effect">{{ attackText(attack, french) }}</p>
            <p v-if="!attack.usable" class="pvp-sheet-note">{{ t('pvp.blocks.unusable') }}</p>
            <p v-else-if="attack.partial" class="pvp-sheet-note">{{ t('pvp.notApplied') }}</p>
          </li>
        </ul>

        <template v-if="card.abilities?.length">
          <h3 class="pvp-sheet-title">{{ t('pvp.ability') }}</h3>
          <ul class="pvp-sheet-attacks">
            <li v-for="(ability, i) in card.abilities" :key="i">
              <p class="pvp-sheet-attack"><strong>{{ (french && ability.name_fr) || ability.name }}</strong></p>
              <p class="pvp-sheet-note">{{ t(`pvp.abilityKinds.${ability.playable ? ability.kind : 'unknown'}`) }}</p>
              <p class="pvp-sheet-effect">{{ (french && ability.text_fr) || ability.text }}</p>
            </li>
          </ul>
          <p class="pvp-sheet-note">{{ t('pvp.abilityNote') }}</p>
        </template>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.pvp-sheet-kind {
  margin: 0;
  font-weight: 800;
}

.pvp-sheet-trainer {
  white-space: pre-line;
}

.pvp-sheet {
  width: min(720px, calc(100% - 2rem));
  max-width: none;
  max-height: calc(100dvh - 2rem);
  padding: 0;
  border: 1px solid var(--pb-border);
  border-radius: var(--pb-radius-lg);
  background: var(--pb-bg-elevated);
  color: var(--pb-text);
  box-shadow: var(--pb-shadow-lg);
  overflow-y: auto;
}

.pvp-sheet::backdrop {
  background: rgba(5, 7, 15, 0.7);
}

.pvp-sheet-inner {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1rem;
  padding: 1.25rem;
}

@media (min-width: 576px) {
  .pvp-sheet-inner {
    grid-template-columns: 11rem minmax(0, 1fr);
  }
}

.pvp-sheet-card {
  max-width: 11rem;
  margin-inline: auto;
}

.pvp-sheet-close {
  position: absolute;
  top: 0.6rem;
  right: 0.6rem;
  z-index: 2;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid var(--pb-border-strong);
  background: var(--pb-bg-elevated);
  color: var(--pb-text);
}

.pvp-sheet-close svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
}

.pvp-sheet-text {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  min-width: 0;
}

.pvp-sheet-name {
  margin: 0 2.5rem 0 0;
  font-size: 1.2rem;
  font-weight: 800;
  overflow-wrap: anywhere;
}

.pvp-sheet-facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.4rem;
  margin: 0;
}

.pvp-sheet-facts > div {
  min-width: 0;
  padding: 0.4rem 0.5rem;
  border-radius: var(--pb-radius-md);
  background: var(--pb-surface);
}

.pvp-sheet-facts dt {
  font-size: 0.7rem;
  color: var(--pb-text-muted);
}

.pvp-sheet-facts dd {
  margin: 0;
  font-weight: 700;
  font-size: 0.8rem;
  overflow-wrap: anywhere;
}

.pvp-sheet-title {
  margin: 0.25rem 0 0;
  font-size: 0.95rem;
  font-weight: 700;
}

.pvp-sheet-attacks {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.pvp-sheet-attacks li {
  padding: 0.6rem 0.75rem;
  border-radius: var(--pb-radius-md);
  background: var(--pb-surface);
}

.pvp-sheet-attack {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
}

.pvp-sheet-cost {
  padding: 0.05rem 0.45rem;
  border-radius: 999px;
  background: var(--pb-input-bg);
  font-size: 0.72rem;
  color: var(--pb-text-muted);
}

.pvp-sheet-damage {
  margin-left: auto;
  font-family: var(--pb-font-display);
}

.pvp-sheet-effect {
  margin: 0.3rem 0 0;
  font-size: 0.85rem;
}

.pvp-sheet-note {
  margin: 0.3rem 0 0;
  font-size: 0.75rem;
  color: var(--pb-text-muted);
  font-style: italic;
}
</style>
