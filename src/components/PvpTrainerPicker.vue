<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCardLocale } from '@/composables/useCardLocale'
import { STEP_PARAM, matchesFilter, trainerSteps } from '@/utils/pvp'

// Playing a Trainer of my hand (PvP, migration 0032): asks, one step at a
// time, what its text lets me choose (trainerSteps: cards to discard, one of
// my / their Pokémon, the Stage 2 for Rare Candy, cards to take from my deck
// or discard pile), then emits the 'trainer' move. A step with nothing to
// choose is skipped (the server does what it can), one with a single
// choice is answered for me.
const props = defineProps({
  battle: { type: Object, required: true },
  index: { type: Number, required: true },
})
const emit = defineEmits(['play', 'cancel'])

const { t } = useI18n()
const { cardName } = useCardLocale()

const card = computed(() => props.battle.my_cards[props.index])
const ops = computed(() => card.value?.fx ?? [])
const mine = computed(() => [props.battle.me.active, ...props.battle.me.bench].map((slot, pos) => ({ pos, slot })).filter(({ slot }) => slot))
const theirs = computed(() => [props.battle.them.active, ...props.battle.them.bench].map((slot, pos) => ({ pos, slot })).filter(({ slot }) => slot))
const hand = computed(() => props.battle.me.hand.filter((entry) => entry.index !== props.index))
const sum = (op) => ops.value.filter((o) => o.op === op).reduce((n, o) => n + (o.n ?? 1), 0)

const steps = trainerSteps(card.value)
const step = ref(null)
const params = ref({})
const chosen = ref([]) // multi-select steps: card indexes

/** What a step offers: { multi, max?, exact?, options: [{ value, label }] }. */
function offer(key) {
  const p = params.value
  const pos = (list) => ({ multi: false, options: list.map(({ pos: value, slot }) => ({ value, label: cardName(slot.card) })) })
  switch (key) {
    case 'discard': {
      const n = sum('discard_cost')
      return { multi: true, exact: n, max: n, options: hand.value.map((e) => ({ value: e.index, label: cardName(e.card) })) }
    }
    case 'tool':
      return pos(mine.value.filter(({ slot }) => !slot.tool_card))
    case 'heal':
      return pos(mine.value.filter(({ slot }) => slot.damage > 0))
    case 'candy':
      return pos(mine.value.filter(({ slot }) => slot.card.stage === 'basic' && slot.turn_in < props.battle.turn && hand.value.some((e) => e.card.base_name === slot.card.name)))
    case 'evolve': {
      const basic = mine.value.find(({ pos: at }) => at === p.pos)?.slot.card.name
      return { multi: false, options: hand.value.filter((e) => e.card.base_name === basic).map((e) => ({ value: e.index, label: cardName(e.card) })) }
    }
    case 'scoop': {
      const basic = ops.value.some((o) => o.op === 'scoop' && o.basic)
      return pos(mine.value.filter(({ pos: at, slot }) => (at > 0 || props.battle.me.bench.length > 0) && (!basic || slot.card.stage === 'basic')))
    }
    case 'scoop_to':
      return p.pos === 0 ? pos(mine.value.filter(({ pos: at }) => at > 0)) : { multi: false, options: [] }
    case 'move_from':
      return pos(mine.value.filter(({ slot }) => slot.energy > 0))
    case 'move_to':
      return pos(mine.value.filter(({ pos: at }) => at !== p.pos))
    case 'switch':
      return pos(mine.value.filter(({ pos: at }) => at > 0))
    case 'gust':
      return pos(theirs.value.filter(({ pos: at }) => at > 0))
    case 'energy':
      return pos(theirs.value.filter(({ slot }) => slot.energy > 0))
    case 'pick': {
      const search = ops.value.filter((o) => o.op === 'search')
      const recover = ops.value.filter((o) => o.op === 'recover')
      const from = (ids, list) => ids.filter((i) => list.some((o) => matchesFilter(props.battle.my_cards[i], o)))
      const ids = [...from(props.battle.me.deck_ids ?? [], search), ...from(props.battle.me.discard_ids ?? [], recover)]
      const max = [...search, ...recover].reduce((n, o) => n + (o.n ?? 1), 0)
      return { multi: true, max, options: ids.map((value) => ({ value, label: cardName(props.battle.my_cards[value]) })) }
    }
    default:
      return { multi: false, options: [] }
  }
}

const current = computed(() => (step.value ? offer(step.value) : null))

/** Goes to the next step that needs me; plays the card when none is left. */
function advance(from) {
  for (let i = from; i < steps.length; i++) {
    const key = steps[i]
    const { multi, exact, options } = offer(key)
    if (!options.length) continue
    if (!multi && options.length === 1) {
      params.value = { ...params.value, [STEP_PARAM[key]]: options[0].value }
      continue
    }
    if (multi && exact && options.length === exact) {
      params.value = { ...params.value, [STEP_PARAM[key]]: options.map((o) => o.value) }
      continue
    }
    step.value = key
    chosen.value = []
    return
  }
  step.value = null
  emit('play', { type: 'trainer', card: props.index, ...params.value })
}

function choose(value) {
  params.value = { ...params.value, [STEP_PARAM[step.value]]: value }
  advance(steps.indexOf(step.value) + 1)
}

function toggle(value) {
  if (chosen.value.includes(value)) chosen.value = chosen.value.filter((v) => v !== value)
  else if (chosen.value.length < current.value.max) chosen.value = [...chosen.value, value]
}

const canConfirm = computed(() => current.value?.multi && (current.value.exact ? chosen.value.length === current.value.exact : true))

function confirm() {
  // a pick of my deck / discard pile: the cards I took; the server takes nothing else
  params.value = { ...params.value, [STEP_PARAM[step.value]]: chosen.value }
  advance(steps.indexOf(step.value) + 1)
}

onMounted(() => advance(0))
</script>

<template>
  <div v-if="step && current" class="pvp-picker">
    <p class="pvp-panel-title">{{ t(`pvp.steps.${step}`, { count: current.max ?? 1 }, current.max ?? 1) }}</p>
    <div class="pvp-choice-buttons">
      <template v-if="current.multi">
        <button
          v-for="(option, i) in current.options"
          :key="`${option.value}-${i}`"
          type="button"
          class="pvp-choice"
          :class="{ 'is-on': chosen.includes(option.value) }"
          :aria-pressed="chosen.includes(option.value)"
          @click="toggle(option.value)"
        >
          {{ option.label }}
        </button>
      </template>
      <template v-else>
        <button v-for="option in current.options" :key="option.value" type="button" class="pvp-choice" @click="choose(option.value)">{{ option.label }}</button>
      </template>
    </div>
    <div class="pvp-choice-buttons">
      <button v-if="current.multi" type="button" class="btn btn-primary btn-sm" :disabled="!canConfirm" @click="confirm">{{ t('pvp.confirm') }}</button>
      <button type="button" class="btn btn-outline-secondary btn-sm" @click="emit('cancel')">{{ t('pvp.cancel') }}</button>
    </div>
  </div>
</template>

<style scoped>
/* Same look as PvpView's choices (scoped styles don't reach a child) */
.pvp-picker {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.pvp-panel-title {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.pvp-choice-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.pvp-choice {
  min-width: 0;
  padding: 0.5rem 0.8rem;
  border-radius: var(--pb-radius-md);
  border: 2px solid var(--pb-border-strong);
  background: var(--pb-surface);
  color: var(--pb-text);
  font-weight: 700;
  overflow-wrap: anywhere;
}

.pvp-choice:not([aria-pressed]),
.pvp-choice.is-on {
  border-color: var(--pb-accent);
}

.pvp-choice.is-on {
  background: var(--pb-selected);
}

.pvp-choice:focus-visible {
  outline: 2px solid var(--pb-focus);
  outline-offset: 2px;
}
</style>
