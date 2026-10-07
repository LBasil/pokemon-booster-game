<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import * as sfx from '@/lib/sfx'
import { useCardLocale } from '@/composables/useCardLocale'
import { usePvpStore } from '@/stores/pvp'
import { useProfileStore } from '@/stores/profile'
import { useSettingsStore } from '@/stores/settings'
import { attackChoices, attackName, attackText, damageLabel } from '@/utils/pvp'
import CoinAmount from '@/components/CoinAmount.vue'
import EnergyIcons from '@/components/EnergyIcons.vue'
import PvpBoardCard from '@/components/PvpBoardCard.vue'
import PvpCardSheet from '@/components/PvpCardSheet.vue'
import PvpTrainerPicker from '@/components/PvpTrainerPicker.vue'

// A PvP battle, laid out like Pokémon TCG Pocket (user, 2026-10-07, after
// sending screenshots of Pocket: "fais-moi la meilleure version possible").
// Phones (< 992px): a full-screen mat, no page around it: their Bench, their
// Active, one line saying what to do now, my Active, my Bench, my hand. What
// I can play glows; the End turn button lights up once nothing else is left;
// the turn's energy is a token beside my Active, dragged (or tapped, then a
// Pokémon) onto a Pokémon; tapping a card opens it big in a bottom sheet with
// its actions (attacks with their text, retreat, abilities). PC (>= 992px):
// the same mat in the page, the log and the actions in a column beside it.
//
// The server holds the rules (migration 0030): I send one move (`pvp_act`)
// and get back the board, `events` (the log) and `hints` (what I can do now,
// why an attack is blocked: null = usable). The view never decides a rule.
const props = defineProps({
  battle: { type: Object, required: true },
  // the battle is over (won, lost, drawn, given up): kept on screen until "Back"
  finished: { type: Boolean, default: false },
  formatName: { type: String, default: '' },
  rules: { type: Object, required: true },
})
const emit = defineEmits(['back'])

const { t, te } = useI18n()
const { french, cardName } = useCardLocale()
const pvp = usePvpStore()
const profile = useProfileStore()
const settings = useSettingsStore()

const typeLabel = (type) => (te(`collection.types.${type}`) ? t(`collection.types.${type}`) : type)
const errorFor = (err) => t(err?.code ? `challenge.errors.${err.code}` : 'challenge.errors.generic')

const busy = ref(false)
const errorMessage = ref('')
const confirmForfeit = ref(false)
const menuOpen = ref(false)
const logOpen = ref(false)

const battle = computed(() => props.battle)
const over = computed(() => props.finished)
const hints = computed(() => battle.value?.hints ?? {})
const myTurn = computed(() => !over.value && hints.value.my_turn)
const opponentName = computed(() => {
  const opponent = battle.value?.opponent
  if (opponent?.bot) return t('pvp.botName', { level: t(`pvp.levels.${opponent.bot}`) })
  return opponent?.username ?? t('pvp.privateTrainer')
})
const myName = computed(() => profile.displayName || t('pvp.you'))
const myCard = (index) => battle.value?.my_cards?.[index] ?? null
/** My Pokémon in play by position: 0 = Active, 1-3 = Bench. */
const mySlot = (pos) => (pos === 0 ? battle.value?.me.active : battle.value?.me.bench[pos - 1]) ?? null
const theirSlot = (pos) => (pos === 0 ? battle.value?.them.active : battle.value?.them.bench[pos - 1]) ?? null
const benchSize = 3

// The page around the mat goes away on phones while a battle is on screen
// (header and tab bar hidden, no page scroll: html.pb-pvp-arena, below)
onMounted(() => document.documentElement.classList.add('pb-pvp-arena'))
onBeforeUnmount(() => document.documentElement.classList.remove('pb-pvp-arena'))

// ---------- What I tapped ----------

// { kind: 'hand', index } | { kind: 'mine' | 'theirs', pos }
const selection = ref(null)
// An attack waiting for its target / Benched Pokémon, or a retreat waiting for who comes in
const pending = ref(null)
const trainerPick = ref(null) // a Trainer of my hand being played (PvpTrainerPicker asks its choices)
const abilityPick = ref(null) // { at, i }: an ability of my Pokémon being used (0033, same picker)
const sheet = ref(null) // { card, slot } read in full

function select(next) {
  pending.value = null
  trainerPick.value = null
  abilityPick.value = null
  menuOpen.value = false
  const same = selection.value && next && selection.value.kind === next.kind && selection.value.index === next.index && selection.value.pos === next.pos
  selection.value = same ? null : next
}

const selectedCard = computed(() => {
  const s = selection.value
  if (!s || !battle.value) return null
  if (s.kind === 'hand') return myCard(s.index)
  return (s.kind === 'mine' ? mySlot(s.pos) : theirSlot(s.pos))?.card ?? null
})
const selectedSlot = computed(() => {
  const s = selection.value
  if (!s || s.kind === 'hand') return null
  return s.kind === 'mine' ? mySlot(s.pos) : theirSlot(s.pos)
})
const handHints = computed(() => (selection.value?.kind === 'hand' ? hints.value.hand?.[selection.value.index] : null))

/** Whether a card of my hand can be played now (the server's hints). */
const handPlayable = (entry) => {
  const h = hints.value.hand?.[entry.index]
  return !!(h?.bench || h?.evolve?.length || (entry.card.stage === 'trainer' && h?.play === null))
}

// The panel: a bottom sheet on phones (open only when there's something in
// it), a column beside the mat on PC (always there). A picked card opens it
// over a backdrop (tap outside to close, like Pocket's zoom); choices
// (targets, a Trainer's steps) leave the mat tappable above it.
const panelOpen = computed(() => over.value || selection.value !== null || !!pending.value?.need || trainerPick.value !== null || !!abilityPick.value)
const sheetModal = computed(() => over.value || (selection.value !== null && !pending.value?.need && trainerPick.value === null && !abilityPick.value))

function closePanel() {
  if (over.value) return
  selection.value = null
  pending.value = null
  trainerPick.value = null
  abilityPick.value = null
}

function onKey(event) {
  if (event.key !== 'Escape') return
  if (menuOpen.value) menuOpen.value = false
  else if (logOpen.value) logOpen.value = false
  else if (energyArmed.value) energyArmed.value = false
  else closePanel()
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

// ---------- What to do now ----------

// User, 2026-10-06, on phones: "je ne savais jamais quand jouer, ou taper,
// que faire". Attach, then attack, else play from the hand, else end the
// turn (the button lights up then)
const nextStep = computed(() => {
  if (!myTurn.value || hints.value.setup || hints.value.promote) return null
  if (hints.value.attach) return 'attach'
  if ((hints.value.attacks ?? []).some((block) => block === null)) return 'attack'
  if ((battle.value?.me.hand ?? []).some(handPlayable)) return 'play'
  return 'end'
})

// After my turn the server plays theirs at once: the mat shows it was their
// turn for a moment (Pocket's red half), skipped with reduced motion
const theirTurnFlash = ref(false)
let flashTimer = null

const resultTitle = computed(() => (over.value ? t(`pvp.result.${battle.value.status}`) : ''))

// One sentence, between the two Actives (Pocket's bubble)
const prompt = computed(() => {
  const h = hints.value
  if (over.value) return resultTitle.value
  if (h.setup) return setupActive.value === null ? t('pvp.prompt.setupActive') : t('pvp.prompt.setupBench', { max: benchSize })
  if (h.promote) return t('pvp.prompt.promote')
  const need = pending.value?.need
  if (need === 'retreat') return t('pvp.prompt.retreat', { cost: retreatLabel.value })
  if (need) return t(need === 'target' ? 'pvp.pickTarget' : need === 'switch_to' ? 'pvp.pickSwitch' : 'pvp.pickEnergyTo')
  if (busy.value && !myTurn.value) return t('pvp.waitHint')
  if (!myTurn.value || theirTurnFlash.value) return t('pvp.theirTurn')
  if (energyArmed.value) return t('pvp.prompt.armed')
  return t(`pvp.next.${nextStep.value}`)
})

const pill = computed(() => {
  if (over.value) return null
  if (theirTurnFlash.value || (!myTurn.value && !hints.value.setup)) return { text: t('pvp.theirTurn'), theirs: true }
  return { text: t('pvp.yourTurn'), theirs: false }
})

// My Active's attacks show when it's picked, and on PC on my turn when nothing is
const showAttacks = computed(() => {
  if (over.value || hints.value.setup || hints.value.promote || trainerPick.value !== null || abilityPick.value || pending.value?.need) return false
  if (!mySlot(0)) return false
  const s = selection.value
  return s ? s.kind === 'mine' && s.pos === 0 : myTurn.value
})

// Weakness / resistance against their Active, from the cards (Pocket says
// "Très efficace" on the attack): my Active's type in their weaknesses
const matchup = computed(() => {
  const mine = mySlot(0)?.card
  const theirs = theirSlot(0)?.card
  if (!mine || !theirs) return null
  const types = mine.types ?? []
  if ((theirs.weaknesses ?? []).some((w) => types.includes(w))) return 'weak'
  if ((theirs.resistances ?? []).some((r) => types.includes(r))) return 'resist'
  return null
})

// ---------- Drag and drop, like Pocket ----------
// User, 2026-10-06: "pas fluide et compliqué de devoir tap partout". A card
// of my hand dragged onto the mat plays it (a Basic onto the Bench, an
// evolution onto its Pokémon, a Trainer anywhere: the picker asks the rest);
// the zone's energy dragged onto a Pokémon attaches it, and so does tapping
// the energy then the Pokémon. A tap still opens the card. The hand scrolls
// sideways (touch-action: pan-x), so a drag starts upward on phones. Drop
// targets carry data-drop: a position, 'bench-n' (an empty spot), 'side', 'board'.
const drag = ref(null) // { kind: 'hand', index } | { kind: 'energy' }, plus x, y, over once moving
const energyArmed = ref(false)
const DRAG_START = 10 // px before a press becomes a drag
let pressed = null
let justDragged = false

function startDrag(event, source) {
  if (busy.value || over.value || !myTurn.value || hints.value.setup || hints.value.promote || pending.value?.need) return
  if (event.pointerType === 'mouse' && event.button !== 0) return
  pressed = { source, x: event.clientX, y: event.clientY, id: event.pointerId }
  window.addEventListener('pointermove', moveDrag, { passive: false })
  window.addEventListener('pointerup', endDrag)
  window.addEventListener('pointercancel', stopDrag)
}

function moveDrag(event) {
  if (!pressed || event.pointerId !== pressed.id) return
  if (!drag.value) {
    if (Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) < DRAG_START) return
    drag.value = { ...pressed.source }
    selection.value = null
    energyArmed.value = false
  }
  event.preventDefault()
  drag.value = { ...drag.value, x: event.clientX, y: event.clientY, over: dropAt(event.clientX, event.clientY) }
}

function endDrag(event) {
  const dragged = drag.value
  stopDrag()
  if (!dragged) return // a tap: its click handler does the rest
  // the click that follows the release must not select anything
  justDragged = true
  setTimeout(() => (justDragged = false), 0)
  const action = dropAction(dragged, dropAt(event.clientX, event.clientY))
  if (action === 'trainer') trainerPick.value = dragged.index
  else if (action) act(action)
}

function stopDrag() {
  pressed = null
  drag.value = null
  window.removeEventListener('pointermove', moveDrag)
  window.removeEventListener('pointerup', endDrag)
  window.removeEventListener('pointercancel', stopDrag)
}

onBeforeUnmount(stopDrag)

/** The drop target under a point (its data-drop), null if none. */
function dropAt(x, y) {
  return document.elementFromPoint(x, y)?.closest('[data-drop]')?.dataset.drop ?? null
}

/**
 * What dropping this on that target does, from the server's hints: a move
 * for pvp_act, 'trainer' (PvpTrainerPicker asks the rest) or null.
 */
function dropAction(dragged, target) {
  if (!dragged || target === null) return null
  const pos = /^\d$/.test(target) ? Number(target) : null
  if (dragged.kind === 'energy') return hints.value.attach && pos !== null && mySlot(pos) ? { type: 'attach', pos } : null
  const card = myCard(dragged.index)
  const hand = hints.value.hand?.[dragged.index]
  if (!card || !hand) return null
  if (card.stage === 'trainer') return hand.play === null ? 'trainer' : null
  if (pos !== null && hand.evolve?.includes(pos)) return { type: 'evolve', card: dragged.index, pos }
  if (hand.bench && target !== 'board') return { type: 'bench', card: dragged.index }
  return null
}

const isDrop = (target) => !!drag.value && !!dropAction(drag.value, target)

function tapEnergy() {
  if (justDragged || busy.value) return
  selection.value = null
  energyArmed.value = !energyArmed.value
}

watch(
  () => hints.value.attach,
  (attach) => {
    if (!attach) energyArmed.value = false
  },
)

// Damage shown on the Pokémon it hit, for a moment ('mine-0' -> 30); not on
// a knocked out one (another Pokémon takes its place)
const hits = ref({})
let hitsTimer = null

function showHits(events) {
  const next = {}
  const out = new Set(events.filter((e) => e.k === 'ko').map((e) => `${e.s === 'a' ? 'mine' : 'theirs'}-${e.pos}`))
  for (const e of events) {
    if (e.k !== 'damage' || !(e.n > 0)) continue
    const key = `${e.s === 'a' ? 'mine' : 'theirs'}-${e.pos}`
    if (!out.has(key)) next[key] = (next[key] ?? 0) + e.n
  }
  hits.value = next
  clearTimeout(hitsTimer)
  hitsTimer = setTimeout(() => (hits.value = {}), 1600)
}

const hitAt = (side, pos) => hits.value[`${side}-${pos}`] ?? 0

onBeforeUnmount(() => {
  clearTimeout(hitsTimer)
  clearTimeout(flashTimer)
})

function openSheet(card, slot = null) {
  sheet.value = card ? { card, slot } : null
}

// ---------- Setup: my Active and Benched picks among the Basics in my hand ----------

const setupActive = ref(null)
const setupBench = ref([])

function resetSetup() {
  setupActive.value = null
  setupBench.value = []
}

const placed = (index) => setupActive.value === index || setupBench.value.includes(index)

function tapHand(entry) {
  if (busy.value || over.value || justDragged) return
  if (hints.value.setup) {
    if (entry.card.stage !== 'basic') return openSheet(entry.card)
    if (setupActive.value === entry.index) setupActive.value = null
    else if (setupBench.value.includes(entry.index)) setupBench.value = setupBench.value.filter((i) => i !== entry.index)
    else if (setupActive.value === null) setupActive.value = entry.index
    else if (setupBench.value.length < benchSize) setupBench.value = [...setupBench.value, entry.index]
    return
  }
  select({ kind: 'hand', index: entry.index })
}

function tapMine(pos) {
  if (busy.value || over.value || justDragged) return
  if (hints.value.promote) {
    if (pos > 0) act({ type: 'promote', pos })
    return
  }
  // the energy picked up (tapped), now its Pokémon
  if (energyArmed.value) {
    energyArmed.value = false
    if (hints.value.attach) act({ type: 'attach', pos })
    return
  }
  const need = pending.value?.need
  if (pos > 0 && need === 'retreat') return act({ type: 'retreat', pos })
  if (pos > 0 && (need === 'switch_to' || need === 'energy_to')) return chooseStep(pos)
  select({ kind: 'mine', pos })
}

function tapTheirs(pos) {
  if (pending.value?.need === 'target') return chooseStep(pos)
  select({ kind: 'theirs', pos })
}

// ---------- Moves ----------

/** The events of my last move (and the server's turn), else the battle's last ones. */
const recent = ref([])
const logEl = ref(null)

async function act(action) {
  if (busy.value) return
  busy.value = true
  errorMessage.value = ''
  confirmForfeit.value = false
  menuOpen.value = false
  try {
    const result = await pvp.act(action)
    recent.value = result.events
    showHits(result.events)
    pending.value = null
    trainerPick.value = null
    abilityPick.value = null
    // Keep my Pokémon picked while it's still there; a played card leaves the hand
    if (selection.value?.kind !== 'mine' || action.type === 'attack' || action.type === 'end' || action.type === 'retreat') selection.value = null
    playSounds(result.events)
    // their turn went by: the mat says so for a moment
    if (result.battle.status === 'playing' && result.events.some((e) => e.k === 'turn' && e.s === 'd') && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      theirTurnFlash.value = true
      clearTimeout(flashTimer)
      flashTimer = setTimeout(() => (theirTurnFlash.value = false), 1100)
    }
  } catch (err) {
    errorMessage.value = errorFor(err)
    // The battle is gone server side: back to the lobby
    if (err?.code === 'no_game') pvp.load()
  } finally {
    busy.value = false
  }
}

function playSounds(events) {
  if (events.some((e) => e.k === 'over')) {
    const end = events.find((e) => e.k === 'over')
    if (end.winner === 'a') sfx.hit(settings.sound)
    else sfx.buzz(settings.vibration)
    return
  }
  if (events.some((e) => e.k === 'ko' && e.s === 'd')) sfx.rare(settings.sound)
  else if (events.some((e) => e.k === 'ko' && e.s === 'a')) sfx.buzz(settings.vibration)
  else sfx.flip(settings.sound)
}

function startBattle() {
  if (setupActive.value === null) return
  act({ type: 'setup', active: setupActive.value, bench: setupBench.value })
}

/** Why an attack of my Active can't be used, null if it can (the server's hints: null = usable). */
function attackBlock(i) {
  const blocks = hints.value.attacks ?? []
  return i < blocks.length ? blocks[i] : 'unknown'
}

// An attack: some need a target or one of my Benched Pokémon first
function useAttack(i) {
  const attack = mySlot(0)?.card.attacks[i]
  if (!attack) return
  const choices = attackChoices(attack)
  const theirBench = battle.value.them.bench.length
  const myBench = battle.value.me.bench.length
  const steps = []
  if (choices.target === 'bench' && theirBench > 1) steps.push('target')
  if (choices.target === 'any' && theirBench > 0) steps.push('target')
  if (choices.switchTo && myBench > 1) steps.push('switch_to')
  if (choices.energyTo && myBench > 1) steps.push('energy_to')
  selection.value = null
  pending.value = { attack: i, steps, choices: {}, need: steps[0] ?? null, anyTarget: choices.target === 'any' }
  if (!steps.length) act({ type: 'attack', attack: i })
}

function chooseStep(value) {
  const p = pending.value
  if (!p?.need) return
  const choices = { ...p.choices, [p.need]: value }
  const rest = p.steps.slice(p.steps.indexOf(p.need) + 1)
  if (rest.length) pending.value = { ...p, choices, need: rest[0] }
  else act({ type: 'attack', attack: p.attack, ...choices })
}

/** Retreat from my Active (Pocket's "Retraite"): then tap who comes in. */
function startRetreat() {
  if (battle.value.me.bench.length === 1) return act({ type: 'retreat', pos: 1 })
  selection.value = null
  pending.value = { need: 'retreat', steps: ['retreat'], choices: {} }
}

/**
 * Why ability i of my Pokémon at pos can't be used now, null if it can
 * (0033: hints.abilities). Not `?? 'unknown'`: null means usable.
 */
function abilityBlock(pos, i) {
  const list = hints.value.abilities?.[pos] ?? []
  return i < list.length ? list[i] : 'unknown'
}
const abilityName = (ability) => (french.value && ability?.name_fr) || ability?.name || ''

/** A card's stage line: its kind for a Trainer. */
const stageLabel = (card) =>
  card.stage === 'trainer'
    ? t(`pvp.trainerKinds.${card.kind}`)
    : card.stage === 'evolution'
      ? t('pvp.stage.evolution', { name: card.evolves_from })
      : t(`pvp.stage.${card.stage}`)

async function forfeit() {
  if (busy.value) return
  if (!confirmForfeit.value) {
    confirmForfeit.value = true
    return
  }
  busy.value = true
  confirmForfeit.value = false
  menuOpen.value = false
  try {
    await pvp.forfeit()
    sfx.buzz(settings.vibration)
  } catch (err) {
    errorMessage.value = errorFor(err)
    if (err?.code === 'no_game') pvp.load()
  } finally {
    busy.value = false
  }
}

const signed = (n) => (n > 0 ? `+${n}` : String(n ?? 0))
// What retreating costs now (Tools, Trainers: 0032), the printed cost before
const retreatCost = computed(() => hints.value.retreat_cost ?? mySlot(0)?.card.retreat ?? 0)
const retreatLabel = computed(() => (retreatCost.value ? t('pvp.energyCount', { count: retreatCost.value }, retreatCost.value) : t('pvp.free')))

// The energy zone (0031): this turn's energy and the next one; null before 0031
const myZone = computed(() => battle.value?.me.zone ?? null)
const energyLine = computed(() => {
  if (!battle.value || !myTurn.value) return ''
  if (hints.value.attach) return myZone.value ? t('pvp.energyReadyType', { type: typeLabel(myZone.value) }) : t('pvp.energyReady')
  return battle.value.turn === 1 ? t('pvp.energyFirst') : t('pvp.energyUsed')
})

// ---------- The log ----------

const eventName = (e) => (french.value && e.name_fr) || e.name || ''
const eventAttack = (e) => (french.value && e.attack_fr) || e.attack || ''
const flipsText = (e) => (e.flips?.length ? ` ${t('pvp.ev.flips', { flips: e.flips.map((up) => t(up ? 'pvp.heads' : 'pvp.tails')).join(', ') })}` : '')

function describe(e, previous) {
  const side = e.s === 'a' ? 'a' : 'd'
  const card = eventName(e)
  const name = opponentName.value
  switch (e.k) {
    case 'start':
      return t(`pvp.ev.start.${e.first === 'a' ? 'a' : 'd'}`, { name })
    case 'turn':
      return t(`pvp.ev.turn.${side}`, { name })
    case 'draw':
      if (side === 'a') {
        const cards = (e.cards ?? []).map((i) => cardName(myCard(i))).filter(Boolean)
        return cards.length ? t('pvp.ev.draw.a', { card: cards.join(', ') }) : ''
      }
      return e.n ? t('pvp.ev.draw.d', { name, count: e.n }, e.n) : ''
    case 'attach':
      if (e.type) return t(`pvp.ev.attachType.${side}`, { name, card, type: typeLabel(e.type) })
      return t(`pvp.ev.attach.${side}`, { name, card })
    case 'bench':
    case 'evolve':
    case 'switch':
    case 'promote':
      return t(`pvp.ev.${e.k}.${side}`, { name, card })
    case 'attack': {
      let text
      if (e.failed) text = t(`pvp.ev.failed.${e.failed}`, { card, attack: eventAttack(e) })
      else if (e.damage > 0) text = t(`pvp.ev.attack.${side}`, { card, attack: eventAttack(e), damage: e.damage })
      else text = t(`pvp.ev.attackNoDamage.${side}`, { card, attack: eventAttack(e) })
      text += flipsText(e)
      if (e.prevented) text += ` ${t('pvp.ev.prevented')}`
      return text
    }
    case 'damage':
      // The attack line already says the damage on the Active
      if (e.pos === 0 && previous?.k === 'attack' && previous.s !== e.s) return ''
      return t(`pvp.ev.damage.${side}`, { card, n: e.n })
    case 'heal':
    case 'discard_energy':
      return t(`pvp.ev.${e.k}.${side}`, { card, n: e.n })
    case 'trainer':
      return t(`pvp.ev.trainer.${side}`, { name, card }) + flipsText(e)
    case 'search':
    case 'recover': {
      const found = e.cards ?? []
      if (!found.length) return e.k === 'search' ? t(`pvp.ev.searchNone.${side}`, { name }) : ''
      // their cards: only how many (their deck isn't mine to name)
      if (side === 'd') return t(`pvp.ev.${e.k}.d`, { name, count: found.length }, found.length)
      const cards = found.map((i) => cardName(myCard(i))).join(', ')
      return t(e.k === 'search' && e.to === 'bench' ? 'pvp.ev.searchBench.a' : `pvp.ev.${e.k}.a`, { cards })
    }
    case 'ability':
      return t(`pvp.ev.ability.${side}`, { card, ability: (french.value && e.ability_fr) || e.ability || '' }) + flipsText(e)
    case 'scoop':
    case 'move_energy':
      return t(`pvp.ev.${e.k}.${side}`, { name, card })
    case 'status':
    case 'cured':
      return t(`pvp.ev.${e.k}.${side}`, { card, status: t(`pvp.statuses.${e.status}`).toLowerCase() })
    case 'ko':
      return t(`pvp.ev.ko.${side}`, { card, name, points: e.points })
    case 'end':
      return t(`pvp.ev.end.${side}`, { name })
    case 'over': {
      const text = t(`pvp.ev.over.${e.winner === 'a' ? 'a' : e.winner === 'd' ? 'd' : 'draw'}`, { name })
      return e.reason === 'turns' ? `${t('pvp.ev.overTurns')} ${text}` : text
    }
    default:
      return ''
  }
}

function describeAll(events) {
  return events
    .map((e, i) => ({ text: describe(e, events[i - 1]), turn: e.k === 'turn', key: `${i}-${e.k}-${e.t}` }))
    .filter((line) => line.text)
}

// Below describe(): watching evaluates it at once, and with a battle in
// progress (resumed) describe() would reach eventName before its const was
// initialized (TDZ, "Cannot access ... before initialization")
const logLines = computed(() => describeAll(logOpen.value || !recent.value.length ? (battle.value?.log ?? []).slice(logOpen.value ? -60 : -12) : recent.value))

watch(
  logLines,
  async () => {
    await nextTick()
    if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight
  },
  { immediate: true },
)
</script>

<template>
  <section
    class="pvp-battle"
    :class="{
      'is-dragging': drag?.x !== undefined,
      'is-their-turn': pill?.theirs,
      'is-over': over,
    }"
    aria-labelledby="pvp-battle-title"
  >
    <!-- Top: leave (the battle waits), who I'm against and their points, the turn, the menu -->
    <header class="pvp-topbar">
      <RouterLink :to="{ name: 'challenge-games' }" class="pvp-icon-button" :aria-label="t('pvp.leave')" :title="t('pvp.leave')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
      </RouterLink>
      <div class="pvp-plate is-theirs">
        <h2 id="pvp-battle-title" class="pvp-vs">
          {{ t('pvp.vs', { name: opponentName }) }}
          <span v-if="battle.opponent.elo" class="pvp-elo">{{ t('pvp.eloShort', { elo: battle.opponent.elo }) }}</span>
        </h2>
        <span class="pvp-dots" aria-hidden="true">
          <span v-for="n in rules.points" :key="n" :class="{ on: n <= battle.them.points }"></span>
        </span>
        <span class="visually-hidden">{{ t('pvp.theirPoints') }} {{ battle.them.points }} / {{ rules.points }}</span>
      </div>
      <span class="pvp-turn-count">{{ t('pvp.turn', { turn: battle.turn, max: rules.turns }) }}</span>
      <div class="pvp-menu-wrap">
        <button
          type="button"
          class="pvp-icon-button"
          :aria-label="t('pvp.menu')"
          :aria-expanded="menuOpen"
          aria-controls="pvp-menu"
          @click="(menuOpen = !menuOpen), (confirmForfeit = false)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
        <div v-if="menuOpen" id="pvp-menu" class="pvp-menu">
          <p class="pvp-menu-format">{{ formatName }}</p>
          <button
            v-if="!over"
            type="button"
            class="btn btn-sm"
            :class="confirmForfeit ? 'btn-danger' : 'btn-outline-secondary'"
            :disabled="busy"
            @click="forfeit"
          >
            {{ confirmForfeit ? t('pvp.forfeitConfirm') : t('pvp.forfeit') }}
          </button>
          <RouterLink :to="{ name: 'challenge-games' }" class="btn btn-sm btn-outline-secondary">{{ t('pvp.leave') }}</RouterLink>
        </div>
      </div>
    </header>

    <div v-if="errorMessage" class="pvp-error" role="alert">{{ errorMessage }}</div>

    <!-- Their side: Bench on top, Active facing mine -->
    <div class="pvp-side is-theirs" role="group" data-drop="board" :aria-label="t('pvp.theirSide', { name: opponentName })">
      <ul class="pvp-bench" :aria-label="t('pvp.bench')">
        <li v-for="n in benchSize" :key="n">
          <button
            v-if="theirSlot(n)"
            type="button"
            class="pvp-slot"
            :class="{ 'is-selected': selection?.kind === 'theirs' && selection.pos === n, 'is-target': pending?.need === 'target' }"
            :aria-label="`${cardName(theirSlot(n).card)}, ${t('pvp.hp', { left: theirSlot(n).hp_left, hp: theirSlot(n).card.hp })}`"
            @click="tapTheirs(n)"
          >
            <PvpBoardCard :card="theirSlot(n).card" :slot="theirSlot(n)" />
            <span v-if="hitAt('theirs', n)" class="pvp-hit" aria-hidden="true">−{{ hitAt('theirs', n) }}</span>
          </button>
          <span v-else class="pvp-empty"><span class="visually-hidden">{{ t('pvp.emptySlot') }}</span></span>
        </li>
      </ul>
      <div class="pvp-active-row">
        <div class="pvp-aside">
          <span class="pvp-chip">{{ t('pvp.handCount', { count: battle.them.hand_count }) }}</span>
          <span class="pvp-chip">{{ t('pvp.deckLeft', { count: battle.them.deck }) }}</span>
        </div>
        <div class="pvp-active-cell">
          <button
            v-if="theirSlot(0)"
            type="button"
            class="pvp-slot is-active"
            :class="{ 'is-selected': selection?.kind === 'theirs' && selection.pos === 0, 'is-target': pending?.need === 'target' && pending.anyTarget }"
            :aria-label="`${t('pvp.active')}: ${cardName(theirSlot(0).card)}, ${t('pvp.hp', { left: theirSlot(0).hp_left, hp: theirSlot(0).card.hp })}`"
            :disabled="pending?.need === 'target' && !pending.anyTarget"
            @click="tapTheirs(0)"
          >
            <PvpBoardCard :card="theirSlot(0).card" :slot="theirSlot(0)" />
            <span v-if="hitAt('theirs', 0)" class="pvp-hit" aria-hidden="true">−{{ hitAt('theirs', 0) }}</span>
          </button>
          <span v-else class="pvp-empty is-active"><span class="visually-hidden">{{ t('pvp.emptySlot') }}</span></span>
        </div>
        <div class="pvp-aside is-right">
          <span v-if="battle.them.energy_types?.length" class="pvp-chip pvp-zone-chip">
            {{ t('pvp.energyShort') }} <EnergyIcons :types="battle.them.energy_types" />
            <template v-if="battle.them.next">· {{ t('pvp.nextEnergy') }} <EnergyIcons :types="[battle.them.next]" /></template>
          </span>
        </div>
      </div>
    </div>

    <!-- What to do now, between the two Actives -->
    <div class="pvp-midline">
      <span v-if="pill" class="pvp-turn-pill" :class="{ 'is-theirs': pill.theirs }">{{ pill.text }}</span>
      <p class="pvp-prompt pvp-next" role="status">{{ prompt }}</p>
    </div>

    <!-- What happened: the last lines, the whole log on demand -->
    <div class="pvp-log-wrap" :class="{ 'is-open': logOpen }">
      <div ref="logEl" class="pvp-log" role="log" aria-live="polite" :aria-label="t('pvp.logTitle')">
        <p v-for="line in logLines" :key="line.key" :class="{ 'is-turn': line.turn }">{{ line.text }}</p>
      </div>
      <button type="button" class="pvp-log-toggle" :aria-expanded="logOpen" @click="logOpen = !logOpen">
        {{ logOpen ? t('pvp.logLess') : t('pvp.logMore') }}
      </button>
    </div>

    <!-- My side: Active facing theirs, Bench below -->
    <div class="pvp-side is-mine" role="group" data-drop="side" :aria-label="t('pvp.mySide')">
      <div class="pvp-active-row">
        <div class="pvp-aside">
          <span class="pvp-chip">{{ t('pvp.deckLeft', { count: battle.me.deck }) }}</span>
          <span class="pvp-chip">{{ t('pvp.discardCount', { count: battle.me.discard_ids?.length ?? 0 }) }}</span>
        </div>
        <div class="pvp-active-cell">
          <button
            v-if="mySlot(0)"
            type="button"
            class="pvp-slot is-active"
            :class="{
              'is-selected': selection?.kind === 'mine' && selection.pos === 0,
              'is-playable': nextStep === 'attack' && !energyArmed,
              'is-target': energyArmed,
              'is-drop': isDrop('0'),
              'is-over': drag?.over === '0' && isDrop('0'),
            }"
            data-drop="0"
            :aria-label="`${t('pvp.active')}: ${cardName(mySlot(0).card)}, ${t('pvp.hp', { left: mySlot(0).hp_left, hp: mySlot(0).card.hp })}`"
            :disabled="over || hints.promote"
            @click="tapMine(0)"
          >
            <PvpBoardCard :card="mySlot(0).card" :slot="mySlot(0)" />
            <span v-if="hitAt('mine', 0)" class="pvp-hit" aria-hidden="true">−{{ hitAt('mine', 0) }}</span>
          </button>
          <span v-else-if="hints.setup && setupActive !== null" class="pvp-slot is-active is-setup">
            <PvpBoardCard :card="myCard(setupActive)" />
          </span>
          <span v-else class="pvp-empty is-active" :class="{ 'is-target': hints.setup }">{{ hints.setup ? t('pvp.setupActive') : '' }}</span>
        </div>
        <div class="pvp-aside is-right">
          <!-- Setup: start, or start over (Pocket's "Commencer" / "Réinitialiser") -->
          <div v-if="hints.setup && !over" class="pvp-setup-actions">
            <button type="button" class="btn btn-primary pvp-end" :class="{ 'glow-button is-ready': setupActive !== null }" :disabled="busy || setupActive === null" @click="startBattle">
              {{ t('pvp.setupStart') }}
            </button>
            <button v-if="setupActive !== null" type="button" class="btn btn-sm btn-outline-secondary" :disabled="busy" @click="resetSetup">{{ t('pvp.setupReset') }}</button>
          </div>
          <!-- My turn: end it; the zone's energy (drag it, or tap it then a Pokémon) and the next one -->
          <div v-else-if="!over" class="pvp-turn-bar">
            <button
              type="button"
              class="btn pvp-end"
              :class="nextStep === 'end' || nextStep === 'play' ? 'btn-primary glow-button is-ready' : 'btn-outline-secondary'"
              :disabled="busy || !myTurn || !!pending"
              @click="act({ type: 'end' })"
            >
              {{ t('pvp.endTurn') }}
            </button>
            <div class="pvp-energy-zone">
              <button
                v-if="hints.attach && myZone && myTurn"
                type="button"
                class="pvp-energy-token"
                :class="{ 'is-armed': energyArmed }"
                :aria-pressed="energyArmed"
                :aria-label="t('pvp.energyToken', { type: typeLabel(myZone) })"
                :title="t('pvp.energyToken', { type: typeLabel(myZone) })"
                @pointerdown="startDrag($event, { kind: 'energy' })"
                @click="tapEnergy"
              >
                <EnergyIcons :types="[myZone]" />
              </button>
              <span v-else class="pvp-energy-spot" aria-hidden="true"></span>
              <span v-if="battle.me.next && !battle.winner" class="pvp-energy-next">
                {{ t('pvp.nextEnergy') }} <EnergyIcons :types="[battle.me.next]" />
              </span>
            </div>
            <span class="pvp-energy-text">{{ energyLine }}</span>
          </div>
        </div>
      </div>
      <ul class="pvp-bench" :aria-label="t('pvp.bench')">
        <li v-for="n in benchSize" :key="n">
          <button
            v-if="mySlot(n)"
            type="button"
            class="pvp-slot"
            :class="{
              'is-selected': selection?.kind === 'mine' && selection.pos === n,
              'is-target': hints.promote || ['switch_to', 'energy_to', 'retreat'].includes(pending?.need) || energyArmed,
              'is-drop': isDrop(String(n)),
              'is-over': drag?.over === String(n) && isDrop(String(n)),
            }"
            :data-drop="n"
            :aria-label="`${cardName(mySlot(n).card)}, ${t('pvp.hp', { left: mySlot(n).hp_left, hp: mySlot(n).card.hp })}`"
            :disabled="over"
            @click="tapMine(n)"
          >
            <PvpBoardCard :card="mySlot(n).card" :slot="mySlot(n)" />
            <span v-if="hitAt('mine', n)" class="pvp-hit" aria-hidden="true">−{{ hitAt('mine', n) }}</span>
          </button>
          <span v-else-if="hints.setup && setupBench[n - 1] !== undefined" class="pvp-slot is-setup">
            <PvpBoardCard :card="myCard(setupBench[n - 1])" />
          </span>
          <span v-else class="pvp-empty" :data-drop="`bench-${n}`" :class="{ 'is-drop': isDrop('bench'), 'is-over': drag?.over === `bench-${n}` && isDrop('bench') }">
            <span class="visually-hidden">{{ t('pvp.emptySlot') }}</span>
          </span>
        </li>
      </ul>
    </div>

    <!-- My hand, fanned at the bottom; what I can play glows -->
    <div class="pvp-dock">
      <div class="pvp-dock-head">
        <p class="pvp-plate is-mine">
          <span class="pvp-plate-name">{{ myName }}</span>
          <span class="pvp-dots" aria-hidden="true">
            <span v-for="n in rules.points" :key="n" :class="{ on: n <= battle.me.points }"></span>
          </span>
          <span class="visually-hidden">{{ t('pvp.myPoints') }} {{ battle.me.points }} / {{ rules.points }}</span>
        </p>
        <span class="pvp-hand-count" aria-hidden="true">{{ t('pvp.myHand', { count: battle.me.hand.length }) }}</span>
      </div>
      <ul class="pvp-hand" :aria-label="t('pvp.myHand', { count: battle.me.hand.length })">
        <li v-for="entry in battle.me.hand" :key="entry.index">
          <button
            type="button"
            class="pvp-hand-card"
            :class="{
              'is-selected': selection?.kind === 'hand' && selection.index === entry.index,
              'is-placed': placed(entry.index),
              'is-playable': hints.setup ? entry.card.stage === 'basic' && !placed(entry.index) : handPlayable(entry),
            }"
            :aria-label="cardName(entry.card)"
            :aria-pressed="placed(entry.index)"
            :disabled="over"
            @pointerdown="startDrag($event, { kind: 'hand', index: entry.index })"
            @click="tapHand(entry)"
          >
            <PvpBoardCard :card="entry.card" />
          </button>
        </li>
      </ul>
    </div>

    <!-- What I can do: a bottom sheet on phones, a column beside the mat on PC -->
    <div v-if="sheetModal" class="pvp-sheet-backdrop" aria-hidden="true" @click="closePanel"></div>
    <div class="pvp-panel-actions" :class="{ 'is-open': panelOpen, 'is-modal': sheetModal }">
      <button v-if="panelOpen && !over" type="button" class="pvp-panel-close" :aria-label="t('pvp.close')" @click="closePanel">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>

      <template v-if="over">
        <div class="pvp-feedback" role="status">
          <strong class="pvp-result-title" :class="battle.status === 'won' ? 'pvp-good' : battle.status === 'draw' ? '' : 'pvp-bad'">{{ resultTitle }}</strong>
          <span v-if="!battle.bot">{{ t('pvp.eloChange', { change: signed(battle.elo_change) }) }}</span>
          <span v-else-if="battle.coins" class="pvp-coins-won">{{ t('pvp.coinsWon') }} <CoinAmount :amount="battle.coins" signed /></span>
          <span v-else>{{ t(battle.paid ? 'pvp.noCoins' : 'pvp.unpaid') }}</span>
        </div>
        <button type="button" class="btn btn-primary glow-button" @click="emit('back')">{{ t('pvp.back') }}</button>
      </template>

      <template v-else-if="hints.setup">
        <p class="pvp-panel-title">{{ t('pvp.setupTitle') }}</p>
        <p class="pvp-note">{{ t('pvp.setupHelp') }}</p>
      </template>

      <template v-else-if="hints.promote">
        <p class="pvp-panel-title">{{ t('pvp.promoteTitle') }}</p>
        <p class="pvp-note">{{ t('pvp.promoteHelp') }}</p>
      </template>

      <template v-else-if="trainerPick !== null || abilityPick">
        <PvpTrainerPicker :battle="battle" :index="trainerPick ?? -1" :ability="abilityPick" @play="act" @cancel="(trainerPick = null), (abilityPick = null)" />
      </template>

      <template v-else-if="pending?.need">
        <p class="pvp-panel-title">{{ prompt }}</p>
        <div class="pvp-choice-buttons">
          <template v-if="pending.need === 'target'">
            <button v-if="pending.anyTarget && theirSlot(0)" type="button" class="pvp-choice" @click="chooseStep(0)">{{ cardName(theirSlot(0).card) }}</button>
            <button v-for="n in battle.them.bench.length" :key="n" type="button" class="pvp-choice" @click="chooseStep(n)">{{ cardName(theirSlot(n).card) }}</button>
          </template>
          <template v-else>
            <button v-for="n in battle.me.bench.length" :key="n" type="button" class="pvp-choice" :disabled="busy" @click="tapMine(n)">{{ cardName(mySlot(n).card) }}</button>
          </template>
          <button type="button" class="btn btn-outline-secondary btn-sm" @click="pending = null">{{ t('pvp.cancel') }}</button>
        </div>
      </template>

      <template v-else-if="selectedCard">
        <!-- The card big, like Pocket's zoom -->
        <div class="pvp-focus">
          <div class="pvp-focus-card"><PvpBoardCard :card="selectedCard" :slot="selectedSlot" /></div>
          <div class="pvp-focus-info">
            <p class="pvp-panel-title">{{ cardName(selectedCard) }}</p>
            <p class="pvp-note">
              {{ stageLabel(selectedCard) }}
              <template v-if="selectedSlot && selectedCard.stage !== 'trainer'"> · {{ t('pvp.hp', { left: selectedSlot.hp_left, hp: selectedSlot.hp_max ?? selectedCard.hp }) }}</template>
            </p>
            <button type="button" class="btn btn-outline-secondary btn-sm" @click="openSheet(selectedCard, selectedSlot)">{{ t('pvp.details') }}</button>
          </div>
        </div>
        <!-- A card in my hand -->
        <div v-if="selection.kind === 'hand' && selectedCard.stage === 'trainer'" class="pvp-choice-buttons">
          <button v-if="handHints?.play === null" type="button" class="pvp-choice is-main" :disabled="busy" @click="trainerPick = selection.index">
            {{ t('pvp.play') }}
          </button>
          <p v-else class="pvp-note">{{ t(`pvp.playBlocks.${handHints?.play ?? 'unknown'}`) }}</p>
        </div>
        <div v-else-if="selection.kind === 'hand'" class="pvp-choice-buttons">
          <button v-if="handHints?.bench" type="button" class="pvp-choice is-main" :disabled="busy" @click="act({ type: 'bench', card: selection.index })">
            {{ t('pvp.toBench') }}
          </button>
          <button v-for="pos in handHints?.evolve ?? []" :key="pos" type="button" class="pvp-choice is-main" :disabled="busy" @click="act({ type: 'evolve', card: selection.index, pos })">
            {{ t('pvp.evolveOnto', { name: cardName(mySlot(pos).card) }) }}
          </button>
          <p v-if="!handHints?.bench && !handHints?.evolve?.length" class="pvp-note">{{ t(myTurn ? 'pvp.nothingNow' : 'pvp.theirTurn') }}</p>
        </div>
        <!-- One of my Pokémon -->
        <div v-else-if="selection.kind === 'mine'" class="pvp-choice-buttons">
          <button v-if="hints.attach" type="button" class="pvp-choice" :disabled="busy" @click="act({ type: 'attach', pos: selection.pos })">
            <EnergyIcons v-if="myZone" :types="[myZone]" />
            {{ myZone ? t('pvp.attachType', { type: typeLabel(myZone) }) : t('pvp.attach') }}
          </button>
          <button v-if="selection.pos > 0 && hints.retreat" type="button" class="pvp-choice" :disabled="busy" @click="act({ type: 'retreat', pos: selection.pos })">
            {{ t('pvp.retreatHere', { name: cardName(mySlot(0).card), cost: retreatLabel }) }}
          </button>
        </div>
        <!-- Its abilities (0033) -->
        <ul v-if="selection.kind === 'mine' && selectedCard.abilities?.length" class="pvp-abilities" :aria-label="t('pvp.ability')">
          <li v-for="(ability, i) in selectedCard.abilities" :key="i">
            <button v-if="abilityBlock(selection.pos, i) === null" type="button" class="pvp-choice is-main" :disabled="busy" @click="abilityPick = { at: selection.pos, i }">
              {{ t('pvp.useAbility', { name: abilityName(ability) }) }}
            </button>
            <p v-else class="pvp-note">
              <strong>{{ abilityName(ability) }}</strong> · {{ t(`pvp.abilityBlocks.${abilityBlock(selection.pos, i)}`) }}
            </p>
          </li>
        </ul>
      </template>

      <!-- PC, nothing picked on my turn: the shortest way (attach, attack) -->
      <template v-else-if="myTurn">
        <p class="pvp-panel-title">{{ t('pvp.attacks') }}</p>
        <div v-if="hints.attach && mySlot(0)" class="pvp-choice-buttons">
          <button type="button" class="pvp-choice" :disabled="busy" @click="act({ type: 'attach', pos: 0 })">
            <EnergyIcons v-if="myZone" :types="[myZone]" />
            {{ myZone ? t('pvp.attachTypeTo', { type: typeLabel(myZone), name: cardName(mySlot(0).card) }) : t('pvp.attach') }}
          </button>
        </div>
      </template>
      <p v-else class="pvp-note">{{ prompt }}</p>

      <!-- My Active's attacks, with their text, like Pocket -->
      <div v-if="showAttacks" class="pvp-attack-buttons" role="group" :aria-label="t('pvp.attacks')">
        <button v-for="(attack, i) in mySlot(0).card.attacks" :key="i" type="button" class="pvp-attack-button" :disabled="busy || attackBlock(i) !== null" @click="useAttack(i)">
          <EnergyIcons class="pvp-attack-cost" :types="attack.energy ?? []" :count="attack.cost" free />
          <span class="pvp-attack-title">
            <span class="pvp-attack-name">{{ attackName(attack, french) }}</span>
            <small v-if="attackBlock(i)" class="pvp-attack-block">{{ t(`pvp.blocks.${attackBlock(i)}`) }}</small>
            <small v-if="attackText(attack, french)" class="pvp-attack-text">{{ attackText(attack, french) }}</small>
          </span>
          <span class="pvp-attack-damage">
            <strong>{{ damageLabel(attack) }}</strong>
            <span v-if="matchup && damageLabel(attack)" class="pvp-matchup" :class="`is-${matchup}`">
              {{ matchup === 'weak' ? t('pvp.superEffective') : t('pvp.resisted', { n: rules.resistance }) }}
            </span>
          </span>
        </button>
      </div>
      <!-- Retreat from my Active (then tap who comes in) -->
      <button v-if="selection?.kind === 'mine' && selection.pos === 0 && hints.retreat && !pending" type="button" class="pvp-choice pvp-retreat" :disabled="busy" @click="startRetreat">
        {{ t('pvp.retreat', { cost: retreatLabel }) }}
      </button>
    </div>

    <!-- What I'm dragging, under my finger -->
    <div v-if="drag?.x !== undefined" class="pvp-ghost" :class="{ 'is-energy': drag.kind === 'energy' }" :style="{ left: `${drag.x}px`, top: `${drag.y}px` }" aria-hidden="true">
      <EnergyIcons v-if="drag.kind === 'energy'" :types="[myZone]" />
      <PvpBoardCard v-else-if="myCard(drag.index)" :card="myCard(drag.index)" />
    </div>

    <PvpCardSheet :card="sheet?.card ?? null" :slot="sheet?.slot ?? null" @close="sheet = null" />
  </section>
</template>

<style>
/* Phones: the battle takes the whole screen (header, tab bar and page scroll gone) */
@media (max-width: 991.98px) {
  html.pb-pvp-arena,
  html.pb-pvp-arena body {
    overflow: hidden;
  }

  html.pb-pvp-arena .app-header,
  html.pb-pvp-arena .app-tabbar {
    display: none;
  }
}
</style>

<style scoped>
/* ---------- The mat ---------- */

.pvp-battle {
  --pvp-gap: 0.4rem;
  --hand-h: clamp(4.5rem, 13dvh, 7.5rem);
  position: fixed;
  inset: 0;
  z-index: 45;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto auto minmax(0, 1fr) auto auto minmax(0, 1fr) auto;
  grid-template-areas: 'top' 'error' 'theirs' 'mid' 'log' 'mine' 'dock';
  gap: var(--pvp-gap);
  padding: calc(0.4rem + env(safe-area-inset-top)) 0.5rem calc(0.35rem + env(safe-area-inset-bottom));
  overflow: hidden;
  color: var(--pb-text);
  /* Their half warm, mine cool, like Pocket's mat */
  background: linear-gradient(
    to bottom,
    color-mix(in srgb, var(--pb-danger-text) 7%, var(--pb-bg)) 0%,
    var(--pb-bg) 46%,
    var(--pb-bg) 54%,
    color-mix(in srgb, var(--pb-focus) 8%, var(--pb-bg)) 100%
  );
  transition: background-color 0.3s;
}

.pvp-battle.is-their-turn {
  background: linear-gradient(
    to bottom,
    color-mix(in srgb, var(--pb-danger-text) 18%, var(--pb-bg)) 0%,
    color-mix(in srgb, var(--pb-danger-text) 6%, var(--pb-bg)) 60%,
    var(--pb-bg) 100%
  );
}

/* ---------- Top bar ---------- */

.pvp-topbar {
  grid-area: top;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.pvp-icon-button {
  display: grid;
  flex: none;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  padding: 0;
  border-radius: 50%;
  border: 1px solid var(--pb-border-strong);
  background: var(--pb-bg-elevated);
  color: var(--pb-text);
}

.pvp-icon-button svg {
  width: 1.15rem;
  height: 1.15rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.pvp-icon-button:focus-visible,
.pvp-slot:focus-visible,
.pvp-hand-card:focus-visible,
.pvp-energy-token:focus-visible,
.pvp-log-toggle:focus-visible,
.pvp-choice:focus-visible,
.pvp-attack-button:focus-visible,
.pvp-panel-close:focus-visible {
  outline: 2px solid var(--pb-focus);
  outline-offset: 2px;
}

.pvp-plate {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
  margin: 0;
}

.pvp-topbar .pvp-plate {
  flex: 1;
  flex-wrap: wrap;
  row-gap: 0.1rem;
}

.pvp-vs {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  font-family: var(--pb-font-display);
  font-size: 0.85rem;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pvp-elo {
  color: var(--pb-text-muted);
  font-family: var(--pb-font-body);
  font-size: 0.72rem;
  font-weight: 700;
}

/* Points: one dot per point to win, filled as they're taken (Pocket) */
.pvp-dots {
  display: inline-flex;
  flex: none;
  gap: 0.2rem;
}

.pvp-dots > span {
  width: 0.8rem;
  height: 0.8rem;
  border-radius: 50%;
  border: 2px solid var(--pb-border-strong);
  background: var(--pb-bg-elevated);
}

.pvp-dots > span.on {
  border-color: var(--pb-accent);
  background: var(--pb-accent);
  box-shadow: 0 0 6px var(--pb-accent);
}

.pvp-turn-count {
  flex: none;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  border: 1px solid var(--pb-border);
  background: var(--pb-bg-elevated);
  font-size: 0.72rem;
  font-weight: 800;
  white-space: nowrap;
}

.pvp-menu-wrap {
  position: relative;
  flex: none;
}

.pvp-menu {
  position: absolute;
  top: calc(100% + 0.4rem);
  right: 0;
  z-index: 6;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: max-content;
  max-width: 16rem;
  padding: 0.75rem;
  border-radius: var(--pb-radius-md);
  border: 1px solid var(--pb-border-strong);
  background: var(--pb-bg-elevated);
  box-shadow: var(--pb-shadow-lg);
}

.pvp-menu-format {
  margin: 0;
  color: var(--pb-text-muted);
  font-size: 0.78rem;
  font-weight: 700;
}

.pvp-error {
  grid-area: error;
  padding: 0.4rem 0.75rem;
  border-radius: var(--pb-radius-md);
  background: var(--pb-danger-bg);
  color: var(--pb-danger-text);
  font-size: 0.8rem;
  font-weight: 700;
}

/* ---------- Sides: Bench + Active, mirrored ---------- */

.pvp-side {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--pvp-gap);
  min-height: 0;
}

.pvp-side.is-theirs {
  grid-area: theirs;
  grid-template-rows: minmax(0, 0.62fr) minmax(0, 1fr);
}

.pvp-side.is-mine {
  grid-area: mine;
  grid-template-rows: minmax(0, 1fr) minmax(0, 0.62fr);
}

.pvp-bench {
  display: flex;
  justify-content: center;
  gap: 0.6rem;
  min-height: 0;
  height: 100%;
  margin: 0;
  padding: 0;
  list-style: none;
}

.pvp-bench > li,
.pvp-active-cell {
  height: 100%;
  min-height: 0;
  aspect-ratio: 245 / 342;
}

.pvp-active-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 0.5rem;
  min-height: 0;
  height: 100%;
}

.pvp-aside {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.3rem;
  min-width: 0;
}

.pvp-aside.is-right {
  align-items: flex-end;
}

.pvp-chip {
  max-width: 100%;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  border: 1px solid var(--pb-border);
  background: var(--pb-bg-elevated);
  color: var(--pb-text-muted);
  font-size: 0.68rem;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.pvp-zone-chip {
  text-align: right;
}

/* A card on the mat: the card itself, a ring when it matters */
.pvp-slot {
  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  border-radius: 0.45rem;
  background: none;
  color: var(--pb-text);
  cursor: pointer;
  transition:
    transform 0.2s var(--pb-ease-out),
    box-shadow 0.2s;
}

.pvp-slot.is-setup,
.pvp-slot:disabled {
  cursor: default;
}

.pvp-slot.is-selected {
  box-shadow: 0 0 0 3px var(--pb-accent);
}

.pvp-slot.is-target {
  box-shadow:
    0 0 0 3px var(--pb-ring),
    0 0 14px var(--pb-ring);
}

/* What I can do now glows (Pocket's cyan) */
.pvp-slot.is-playable:not(.is-selected) {
  box-shadow:
    0 0 0 3px var(--pb-focus),
    0 0 16px var(--pb-focus);
}

@media (hover: hover) {
  .pvp-slot:not(:disabled):not(.is-setup):hover {
    transform: translateY(-2px);
  }
}

.pvp-empty {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  border-radius: 0.45rem;
  border: 2px solid var(--pb-border);
  background: color-mix(in srgb, var(--pb-bg-elevated) 50%, transparent);
  color: var(--pb-text-muted);
  font-size: 0.75rem;
  font-weight: 800;
}

.pvp-empty.is-target {
  border-style: dashed;
  border-color: var(--pb-focus);
  color: var(--pb-text);
}

.pvp-slot.is-drop,
.pvp-empty.is-drop {
  outline: 2px dashed var(--pb-accent);
  outline-offset: 2px;
}

.pvp-slot.is-over,
.pvp-empty.is-over {
  outline-style: solid;
  box-shadow: 0 0 0 4px var(--pb-accent);
  transform: scale(1.04);
}

/* ---------- Between the Actives: whose turn, what to do ---------- */

.pvp-midline {
  grid-area: mid;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-height: 2.6rem;
  padding: 0.35rem 0.75rem;
  border-radius: 999px;
  border: 1px solid var(--pb-border-strong);
  background: var(--pb-bg-elevated);
  box-shadow: var(--pb-shadow-card);
}

.pvp-turn-pill {
  flex: none;
  padding: 0.15rem 0.6rem;
  border-radius: 999px;
  background: var(--pb-focus);
  color: var(--pb-bg);
  font-size: 0.72rem;
  font-weight: 800;
  white-space: nowrap;
}

.pvp-turn-pill.is-theirs {
  background: var(--pb-danger-text);
}

.pvp-prompt {
  min-width: 0;
  margin: 0;
  font-size: 0.8rem;
  font-weight: 700;
  line-height: 1.25;
}

.is-over .pvp-prompt {
  font-family: var(--pb-font-display);
  font-size: 1rem;
}

/* ---------- The log: 2 lines, the whole of it on demand ---------- */

.pvp-log-wrap {
  grid-area: log;
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  min-width: 0;
  padding: 0 0.5rem;
}

.pvp-log {
  flex: 1;
  min-width: 0;
  max-height: 2.4rem;
  overflow-y: auto;
  color: var(--pb-text-muted);
  font-size: 0.72rem;
  line-height: 1.2rem;
}

.pvp-log p {
  margin: 0;
}

.pvp-log p::first-letter {
  text-transform: uppercase;
}

.pvp-log p.is-turn {
  color: var(--pb-text);
  font-weight: 800;
}

.pvp-log-toggle {
  flex: none;
  padding: 0 0.5rem;
  border-radius: 999px;
  border: 1px solid var(--pb-border);
  background: var(--pb-bg-elevated);
  color: var(--pb-text-muted);
  font-size: 0.7rem;
  font-weight: 700;
  line-height: 1.4rem;
}

.pvp-log-wrap.is-open {
  position: absolute;
  top: 3.25rem;
  left: 0.5rem;
  right: 0.5rem;
  z-index: 5;
  flex-direction: column;
  align-items: stretch;
  padding: 0.75rem;
  border-radius: var(--pb-radius-md);
  border: 1px solid var(--pb-border-strong);
  background: var(--pb-bg-elevated);
  box-shadow: var(--pb-shadow-lg);
}

.pvp-log-wrap.is-open .pvp-log {
  max-height: 55dvh;
  color: var(--pb-text);
  font-size: 0.8rem;
}

.pvp-log-wrap.is-open .pvp-log-toggle {
  align-self: flex-end;
}

/* ---------- My turn: end it, the energy zone ---------- */

.pvp-turn-bar,
.pvp-setup-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.45rem;
  min-width: 0;
}

.pvp-end {
  max-width: 100%;
  padding: 0.45rem 0.8rem;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 800;
  line-height: 1.2;
}

.pvp-energy-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
}

.pvp-energy-token,
.pvp-energy-spot {
  display: grid;
  place-items: center;
  width: 3rem;
  height: 3rem;
  padding: 0;
  border-radius: 50%;
}

.pvp-energy-token {
  border: 2px solid var(--pb-accent);
  background: var(--pb-bg-elevated);
  box-shadow: 0 0 14px var(--pb-accent);
  cursor: grab;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  animation: pvp-energy-pulse 1.6s ease-in-out infinite;
}

.pvp-energy-token :deep(.energy-dot),
.pvp-ghost.is-energy :deep(.energy-dot) {
  width: 2rem;
  height: 2rem;
}

.pvp-energy-token.is-armed {
  background: var(--pb-accent);
  box-shadow:
    0 0 0 3px var(--pb-ring),
    0 0 18px var(--pb-accent);
  animation: none;
}

.pvp-energy-spot {
  border: 2px dashed var(--pb-border-strong);
}

@keyframes pvp-energy-pulse {
  50% {
    transform: scale(1.08);
  }
}

.pvp-energy-next {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  color: var(--pb-text-muted);
  font-size: 0.66rem;
  font-weight: 700;
  white-space: nowrap;
}

.pvp-energy-text {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

/* ---------- My hand ---------- */

.pvp-dock {
  grid-area: dock;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
  transition: opacity 0.2s;
}

.pvp-dock-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0 0.25rem;
}

.pvp-plate-name {
  min-width: 0;
  overflow: hidden;
  font-family: var(--pb-font-display);
  font-size: 0.8rem;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pvp-hand-count {
  color: var(--pb-text-muted);
  font-size: 0.7rem;
  font-weight: 700;
}

.pvp-hand {
  display: flex;
  justify-content: safe center;
  height: calc(var(--hand-h) + 0.6rem);
  margin: 0;
  padding: 0.6rem 0.5rem 0;
  overflow-x: auto;
  overflow-y: hidden;
  list-style: none;
  scrollbar-width: none;
}

.pvp-hand > li {
  flex: none;
  height: var(--hand-h);
  aspect-ratio: 245 / 342;
}

/* Fanned: each card over the previous one's edge */
.pvp-hand > li + li {
  margin-left: calc(var(--hand-h) * -0.14);
}

.pvp-hand-card {
  display: block;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  border-radius: 0.4rem;
  background: none;
  cursor: grab;
  touch-action: pan-x;
  user-select: none;
  -webkit-user-select: none;
  transition:
    transform 0.2s var(--pb-ease-out),
    box-shadow 0.2s,
    opacity 0.2s;
}

.pvp-hand-card.is-playable {
  transform: translateY(-0.35rem);
  box-shadow:
    0 0 0 2px var(--pb-focus),
    0 0 12px var(--pb-focus);
}

.pvp-hand-card.is-selected {
  transform: translateY(-0.55rem);
  box-shadow: 0 0 0 3px var(--pb-accent);
}

.pvp-hand-card.is-placed {
  opacity: 0.35;
}

.pvp-battle.is-dragging .pvp-panel-actions {
  opacity: 0.2;
  pointer-events: none;
}

/* ---------- The panel: a bottom sheet on phones ---------- */

.pvp-sheet-backdrop {
  position: fixed;
  inset: 0;
  z-index: 7;
  background: color-mix(in srgb, var(--pb-bg) 65%, transparent);
}

.pvp-panel-actions {
  display: none;
  flex-direction: column;
  gap: 0.6rem;
  min-width: 0;
}

.pvp-panel-actions.is-open {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 8;
  display: flex;
  max-height: 78dvh;
  padding: 1rem 1rem calc(1rem + env(safe-area-inset-bottom));
  overflow-y: auto;
  border-radius: var(--pb-radius-lg) var(--pb-radius-lg) 0 0;
  border-top: 1px solid var(--pb-border-strong);
  background: var(--pb-bg-elevated);
  box-shadow: var(--pb-shadow-lg);
}

.pvp-panel-close {
  position: absolute;
  top: 0.6rem;
  right: 0.6rem;
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  padding: 0;
  border-radius: 50%;
  border: 1px solid var(--pb-border);
  background: var(--pb-surface);
  color: var(--pb-text);
}

.pvp-panel-close svg {
  width: 1rem;
  height: 1rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}

.pvp-panel-title {
  margin: 0;
  padding-right: 2.25rem;
  font-family: var(--pb-font-display);
  font-size: 0.95rem;
  font-weight: 700;
}

.pvp-note {
  margin: 0;
  color: var(--pb-text-muted);
  font-size: 0.85rem;
}

.pvp-focus {
  display: grid;
  grid-template-columns: minmax(0, 8.5rem) minmax(0, 1fr);
  gap: 0.85rem;
  align-items: start;
}

.pvp-focus-info {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.4rem;
  min-width: 0;
}

.pvp-choice-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.pvp-choice {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.55rem 0.9rem;
  border-radius: var(--pb-radius-md);
  border: 2px solid var(--pb-border-strong);
  background: var(--pb-surface);
  color: var(--pb-text);
  font-weight: 700;
}

.pvp-choice.is-main,
.pvp-choice:not(:disabled):not(.pvp-retreat) {
  border-color: var(--pb-accent);
}

.pvp-choice:disabled {
  opacity: 0.55;
}

.pvp-retreat {
  align-self: flex-start;
}

/* Attacks: big buttons with their cost, text and damage (Pocket) */
.pvp-attack-buttons {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.pvp-attack-button {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  padding: 0.65rem 0.85rem;
  border-radius: var(--pb-radius-md);
  border: 2px solid var(--pb-border-strong);
  background: var(--pb-surface);
  color: var(--pb-text);
  text-align: left;
}

.pvp-attack-button:not(:disabled) {
  border-color: var(--pb-accent);
  background: color-mix(in srgb, var(--pb-accent) 14%, var(--pb-bg-elevated));
  box-shadow: 0 0 12px color-mix(in srgb, var(--pb-accent) 40%, transparent);
}

.pvp-attack-button:disabled {
  opacity: 0.6;
}

@media (hover: hover) {
  .pvp-attack-button:not(:disabled):hover,
  .pvp-choice:not(:disabled):hover {
    background: var(--pb-surface-hover);
  }
}

.pvp-attack-cost {
  flex-wrap: nowrap;
}

.pvp-attack-title {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}

.pvp-attack-name {
  font-weight: 800;
}

.pvp-attack-block {
  color: var(--pb-danger-text);
  font-weight: 700;
}

.pvp-attack-text {
  color: var(--pb-text-muted);
  font-size: 0.75rem;
  line-height: 1.3;
}

.pvp-attack-damage {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.15rem;
}

.pvp-attack-damage strong {
  font-family: var(--pb-font-display);
  font-size: 1.15rem;
}

.pvp-matchup {
  padding: 0 0.4rem;
  border-radius: 999px;
  font-size: 0.65rem;
  font-weight: 800;
  white-space: nowrap;
}

.pvp-matchup.is-weak {
  background: var(--pb-accent);
  color: var(--pb-accent-ink);
}

.pvp-matchup.is-resist {
  background: var(--pb-selected);
  color: var(--pb-text-muted);
}

.pvp-abilities {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.pvp-feedback {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  text-align: center;
}

.pvp-result-title {
  font-family: var(--pb-font-display);
  font-size: 1.6rem;
}

.pvp-good {
  color: var(--pb-success-text);
}

.pvp-bad {
  color: var(--pb-danger-text);
}

.pvp-coins-won {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-weight: 700;
}

/* ---------- Drag, damage ---------- */

.pvp-ghost {
  position: fixed;
  z-index: 9;
  width: 4.5rem;
  pointer-events: none;
  transform: translate(-50%, -70%) rotate(-4deg);
  opacity: 0.92;
  filter: drop-shadow(0 8px 16px rgb(0 0 0 / 0.35));
}

.pvp-ghost.is-energy {
  width: auto;
  transform: translate(-50%, -120%);
}

.pvp-hit {
  position: absolute;
  top: 30%;
  left: 50%;
  z-index: 2;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  background: var(--pb-danger-text);
  color: var(--pb-bg);
  font-family: var(--pb-font-display);
  font-size: 1.1rem;
  font-weight: 800;
  pointer-events: none;
  transform: translateX(-50%);
  animation: pvp-hit 1.6s var(--pb-ease-out) forwards;
}

@keyframes pvp-hit {
  0% {
    opacity: 0;
    transform: translate(-50%, 0.5rem) scale(0.8);
  }
  15% {
    opacity: 1;
    transform: translate(-50%, 0) scale(1.2);
  }
  75% {
    opacity: 1;
    transform: translate(-50%, -0.25rem) scale(1);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -0.75rem);
  }
}

@media (prefers-reduced-motion: reduce) {
  .pvp-hit,
  .pvp-energy-token {
    animation: none;
  }

  .pvp-battle,
  .pvp-slot,
  .pvp-hand-card {
    transition: none;
  }
}

/* Small phones (375x667): a slimmer hand and a one-line log */
@media (max-height: 700px) {
  .pvp-battle {
    --pvp-gap: 0.3rem;
    --hand-h: clamp(4.25rem, 12dvh, 6rem);
  }

  .pvp-log {
    max-height: 1.2rem;
  }

  .pvp-midline {
    min-height: 2.25rem;
    padding-block: 0.25rem;
  }

  .pvp-energy-token,
  .pvp-energy-spot {
    width: 2.6rem;
    height: 2.6rem;
  }
}

@media (max-width: 374.98px) {
  .pvp-turn-count,
  .pvp-elo {
    display: none;
  }

  .pvp-end {
    padding: 0.4rem 0.55rem;
    font-size: 0.72rem;
  }
}

/* ---------- PC: the mat in the page, the log and the actions beside it ---------- */

@media (min-width: 992px) {
  .pvp-battle {
    --hand-h: clamp(4.5rem, 11dvh, 6.5rem);
    position: relative;
    inset: auto;
    z-index: auto;
    height: clamp(36rem, calc(100dvh - 1.5rem), 58rem);
    grid-template-columns: minmax(0, 1fr) 21rem;
    grid-template-rows: auto auto minmax(0, 1fr) auto minmax(0, 1fr) auto;
    grid-template-areas:
      'top top'
      'error error'
      'theirs log'
      'mid log'
      'mine panel'
      'dock panel';
    column-gap: 1rem;
    padding: 0.85rem;
    scroll-margin-top: 0.75rem;
    border-radius: var(--pb-radius-lg);
    border: 1px solid var(--pb-border);
    box-shadow: var(--pb-shadow-card);
  }

  .pvp-vs {
    font-size: 1rem;
  }

  /* Height is what's scarce on a laptop: smaller Benches, bigger Actives */
  .pvp-side.is-theirs {
    grid-template-rows: minmax(0, 0.5fr) minmax(0, 1fr);
  }

  .pvp-side.is-mine {
    grid-template-rows: minmax(0, 1fr) minmax(0, 0.5fr);
  }

  .pvp-chip {
    font-size: 0.75rem;
  }

  .pvp-midline {
    min-height: 2.75rem;
  }

  .pvp-prompt {
    font-size: 0.88rem;
  }

  .pvp-log-wrap,
  .pvp-log-wrap.is-open {
    position: static;
    flex-direction: column;
    align-items: stretch;
    min-height: 0;
    padding: 0.75rem;
    border-radius: var(--pb-radius-md);
    border: 1px solid var(--pb-border);
    background: var(--pb-bg-elevated);
    box-shadow: none;
    contain: size;
  }

  .pvp-log,
  .pvp-log-wrap.is-open .pvp-log {
    max-height: none;
    min-height: 0;
    color: var(--pb-text);
    font-size: 0.8rem;
    line-height: 1.35;
  }

  .pvp-log p + p {
    margin-top: 0.15rem;
  }

  .pvp-log-toggle {
    align-self: flex-end;
  }

  .pvp-energy-text {
    position: static;
    width: auto;
    height: auto;
    overflow: visible;
    clip: auto;
    max-width: 10rem;
    color: var(--pb-text-muted);
    font-size: 0.72rem;
    font-weight: 700;
    text-align: right;
    white-space: normal;
  }

  .pvp-sheet-backdrop,
  .pvp-panel-close {
    display: none;
  }

  .pvp-panel-actions,
  .pvp-panel-actions.is-open {
    grid-area: panel;
    position: static;
    display: flex;
    max-height: none;
    min-height: 0;
    padding: 0.85rem;
    overflow-y: auto;
    border-radius: var(--pb-radius-md);
    border: 1px solid var(--pb-border);
    background: var(--pb-bg-elevated);
    box-shadow: none;
  }

  .pvp-panel-title {
    padding-right: 0;
  }

  .pvp-focus {
    grid-template-columns: minmax(0, 6.5rem) minmax(0, 1fr);
  }
}
</style>
