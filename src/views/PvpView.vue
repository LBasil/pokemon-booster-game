<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import * as sfx from '@/lib/sfx'
import { useCardLocale } from '@/composables/useCardLocale'
import { useChallengeStore } from '@/stores/challenge'
import { usePvpStore } from '@/stores/pvp'
import { useSettingsStore } from '@/stores/settings'
import { resetTimeLabel } from '@/utils/challenge'
import { searchNeedle } from '@/utils/collection'
import {
  BATTLES_PER_DAY,
  BOT_BATTLES_PER_DAY,
  BOT_COINS,
  BOT_LEVELS,
  BOT_PAID_PER_DAY,
  DECK_ROLES,
  DECK_SIZE,
  ENERGY_TYPES,
  MAX_ENERGY_TYPES,
  MAX_TURNS,
  POINTS_TO_WIN,
  RESISTANCE,
  addBlock,
  attackChoices,
  attackName,
  autoDeck,
  autoEnergy,
  damageLabel,
  deckCheck,
  deckCounts,
  deckEnergy,
  fitsEnergy,
  parseFormat,
  record,
  removeCard,
} from '@/utils/pvp'
import AppHeader from '@/components/AppHeader.vue'
import CoinAmount from '@/components/CoinAmount.vue'
import EnergyIcons from '@/components/EnergyIcons.vue'
import PvpCard from '@/components/PvpCard.vue'
import PvpCardSheet from '@/components/PvpCardSheet.vue'
import PvpTrainerPicker from '@/components/PvpTrainerPicker.vue'

// PvP battles like Pokémon TCG Pocket (challenge mode, migration 0030),
// asynchronous. Per format (every card, one TCG era, one set) I keep two
// decks of 20 challenge Pokémon (2 of a name at most) and 1 or 2 energy types
// (0031): an attack deck I play and a defense deck the server plays when I'm
// attacked. A battle: place a Basic Active and up to 3 Benched Pokémon, then
// each turn attach the zone's energy (a random type of my deck's, the next
// one shown), bench, evolve, retreat, attack. I send one move at a time; the server
// validates it, plays the other side (a player's defense deck or a bot) and
// sends back the board, what happened (`events`) and what I can do now
// (`hints`), so the rules live in one place. Bots pay coins, players move Elo.
// The format is remembered on this device (`pb-pvp-format`).
const FORMAT_KEY = 'pb-pvp-format'
const KINDS = ['all', 'era', 'set']
const FILTERS = ['all', 'basic', 'evolution', 'trainer']
const STAGE_ORDER = { basic: 0, evolution: 1, trainer: 2 }

const { t, te, locale } = useI18n()
const { french, cardName } = useCardLocale()
const pvp = usePvpStore()
const challenge = useChallengeStore()
const settings = useSettingsStore()
const resetTime = computed(() => resetTimeLabel(locale.value))

const format = ref(readFormat())
const busy = ref(false)
const errorMessage = ref('')
const finished = ref(null) // the battle just over, kept on screen until "Back"
const confirmForfeit = ref(false)
const battleEl = ref(null)

function readFormat() {
  try {
    return localStorage.getItem(FORMAT_KEY) || 'all'
  } catch {
    return 'all'
  }
}

watch(format, (value) => {
  try {
    localStorage.setItem(FORMAT_KEY, value)
  } catch {
    // private mode: not remembered
  }
})

const rules = computed(() => ({
  deck: pvp.state?.deck_size ?? DECK_SIZE,
  points: pvp.state?.points_to_win ?? POINTS_TO_WIN,
  turns: pvp.state?.max_turns ?? MAX_TURNS,
  battles: pvp.state?.battles_per_day ?? BATTLES_PER_DAY,
  resistance: pvp.state?.resistance ?? RESISTANCE,
  botCoins: pvp.state?.bot_coins ?? BOT_COINS,
  botPaid: pvp.state?.bot_paid_per_day ?? BOT_PAID_PER_DAY,
  botBattles: pvp.state?.bot_battles_per_day ?? BOT_BATTLES_PER_DAY,
}))

const typeLabel = (type) => (te(`collection.types.${type}`) ? t(`collection.types.${type}`) : type)
const typeList = (types) => (types ?? []).map(typeLabel).join(', ')

const errorFor = (err) => t(err?.code ? `challenge.errors.${err.code}` : 'challenge.errors.generic')

// ---------- Formats ----------

const kind = computed(() => parseFormat(format.value).kind)
const eras = computed(() => pvp.formats.eras ?? [])
const sets = computed(() => pvp.formats.sets ?? [])
const setName = (set) => (french.value && set.name_fr) || set.name

function formatLabel(key) {
  const { kind: k, value } = parseFormat(key)
  if (k === 'all') return t('pvp.formats.all')
  if (k === 'era') return t('pvp.formats.era', { name: value })
  const set = sets.value.find((s) => s.set_id === value)
  return set ? setName(set) : value
}

/** My Pokémon copies in the selected format. */
const ownedHere = computed(() => {
  if (kind.value === 'all') return pvp.formats.all ?? 0
  return [...eras.value, ...sets.value].find((f) => f.format === format.value)?.owned ?? 0
})

function pickKind(next) {
  if (next === kind.value) return
  building.value = null
  if (next === 'all') format.value = 'all'
  // The era / set where I have the most cards
  else {
    const list = next === 'era' ? eras.value : sets.value
    const best = [...list].sort((a, b) => b.owned - a.owned)[0]
    format.value = best?.format ?? (next === 'era' ? 'era:Base' : 'all')
  }
}

function pickFormat(event) {
  building.value = null
  format.value = event.target.value
}

// ---------- Decks ----------

// { attack, defense }: each { ids, valid } or null
const decks = computed(() => pvp.decks[format.value] ?? { attack: null, defense: null })
const rating = computed(() => pvp.ratings[format.value] ?? null)
const myRecord = computed(() => record(rating.value))
const eligible = computed(() => pvp.eligible[format.value] ?? [])
const eligibleById = computed(() => new Map(eligible.value.map((card) => [card.id, card])))
const eligibleLoading = ref(false)
const canFight = computed(() => decks.value.attack?.valid && pvp.battlesLeft > 0 && !building.value)
const canFightBot = computed(() => decks.value.attack?.valid && pvp.botBattlesLeft > 0 && !building.value)

async function loadEligible({ force = false } = {}) {
  eligibleLoading.value = true
  try {
    await pvp.loadEligible(format.value, { force })
  } catch (err) {
    errorMessage.value = errorFor(err)
  } finally {
    eligibleLoading.value = false
  }
}

/** A deck's cards grouped: [{ card, count }], Basics, evolutions, then Trainers, by name. */
function grouped(ids) {
  return [...deckCounts(ids)]
    .map(([id, count]) => ({ id, count, card: eligibleById.value.get(id) }))
    .filter((entry) => entry.card)
    .sort((a, b) => (STAGE_ORDER[a.card.stage] ?? 1) - (STAGE_ORDER[b.card.stage] ?? 1) || cardName(a.card).localeCompare(cardName(b.card)))
}

// Builder: the role being built (null = not building) and its 20 ids
const building = ref(null)
const picks = ref([])
const energy = ref([]) // its 1 or 2 energy types
const search = ref('')
const filter = ref('all')
const check = computed(() => deckCheck(picks.value, eligibleById.value, rules.value.deck, energy.value))
const maxEnergy = computed(() => pvp.state?.max_energy_types ?? MAX_ENERGY_TYPES)
const energyTypes = computed(() => pvp.state?.energy_types ?? ENERGY_TYPES)

/** Picks a type; a third one replaces the older of the two. */
function toggleEnergy(type) {
  if (energy.value.includes(type)) energy.value = energy.value.filter((e) => e !== type)
  else energy.value = [...energy.value, type].slice(-maxEnergy.value)
}

/** The energy that suits my cards, and the deck that goes with it. */
function autoBuild(role) {
  energy.value = autoEnergy(eligible.value, role, rules.value.deck)
  picks.value = autoDeck(eligible.value, role, rules.value.deck, energy.value)
}
const pickedGroups = computed(() => grouped(picks.value))
const counts = computed(() => deckCounts(picks.value))
const shown = computed(() => {
  const needle = searchNeedle(search.value)
  return eligible.value.filter(
    (card) =>
      (filter.value === 'all' || card.stage === filter.value) &&
      (!needle || searchNeedle(card.name).includes(needle) || searchNeedle(card.name_fr ?? '').includes(needle)),
  )
})

/**
 * Opens the builder for one deck: its saved cards (minus the ones I no
 * longer own enough of), or with `auto` the picks of autoDeck(). Nothing is
 * saved until "Save the deck".
 * @param {'attack' | 'defense'} role
 */
async function editDeck(role, { auto = false } = {}) {
  building.value = role
  errorMessage.value = ''
  await loadEligible({ force: true })
  if (auto) return autoBuild(role)
  let kept = []
  for (const id of decks.value[role]?.ids ?? []) {
    const card = eligibleById.value.get(id)
    if (card && !addBlock(kept, card, eligibleById.value, rules.value.deck)) kept = [...kept, id]
  }
  picks.value = kept
  // the saved energy (or the one its cards ask for: saved before 0031); a new deck: the one that suits my cards
  energy.value =
    decks.value[role]?.energy ??
    (kept.length ? deckEnergy(kept.map((id) => eligibleById.value.get(id))) : autoEnergy(eligible.value, role, rules.value.deck))
}

function addPick(card) {
  if (!addBlock(picks.value, card, eligibleById.value, rules.value.deck)) picks.value = [...picks.value, card.id]
}

const removePick = (id) => {
  picks.value = removeCard(picks.value, id)
}

async function saveDeck() {
  if (busy.value || !check.value.ready) return
  busy.value = true
  errorMessage.value = ''
  try {
    await pvp.saveDeck(format.value, picks.value, building.value, energy.value)
    building.value = null
  } catch (err) {
    errorMessage.value = errorFor(err)
  } finally {
    busy.value = false
  }
}

// ---------- Battle ----------

const battle = computed(() => finished.value ?? pvp.battle)
const hints = computed(() => battle.value?.hints ?? {})
const myTurn = computed(() => !finished.value && hints.value.my_turn)
const opponentName = computed(() => {
  const opponent = battle.value?.opponent
  if (opponent?.bot) return botName(opponent.bot)
  return opponent?.username ?? t('pvp.privateTrainer')
})
const botName = (level) => t('pvp.botName', { level: t(`pvp.levels.${level}`) })
const myCard = (index) => battle.value?.my_cards?.[index] ?? null
/** My Pokémon in play by position: 0 = Active, 1-3 = Bench. */
const mySlot = (pos) => (pos === 0 ? battle.value?.me.active : battle.value?.me.bench[pos - 1]) ?? null
const theirSlot = (pos) => (pos === 0 ? battle.value?.them.active : battle.value?.them.bench[pos - 1]) ?? null
const benchSize = 3

// What I tapped: { kind: 'hand', index } | { kind: 'mine' | 'theirs', pos }
const selection = ref(null)
const pending = ref(null) // an attack waiting for its target / Benched Pokémon
const trainerPick = ref(null) // a Trainer of my hand being played (PvpTrainerPicker asks its choices)
const abilityPick = ref(null) // { at, i }: an ability of my Pokémon being used (0033, same picker)
const sheet = ref(null) // { card, slot } read in full

function select(next) {
  pending.value = null
  trainerPick.value = null
  abilityPick.value = null
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

// What to do now on my turn (user, 2026-10-06, on phones: "je ne savais
// jamais quand jouer, ou taper, que faire"): attach, then attack, else play
// from the hand, else end the turn (the button lights up then)
const nextStep = computed(() => {
  if (!myTurn.value || hints.value.setup || hints.value.promote) return null
  if (hints.value.attach) return 'attach'
  if ((hints.value.attacks ?? []).some((block) => block === null)) return 'attack'
  if ((battle.value?.me.hand ?? []).some(handPlayable)) return 'play'
  return 'end'
})

// My Active's attacks show when it's picked, and on my turn when nothing is
// (one tap to attack, like Pocket)
const showAttacks = computed(() => {
  if (finished.value || hints.value.setup || hints.value.promote || trainerPick.value !== null || abilityPick.value || pending.value?.need) return false
  if (!mySlot(0)) return false
  const s = selection.value
  return s ? s.kind === 'mine' && s.pos === 0 : myTurn.value
})

function openSheet(card, slot = null) {
  sheet.value = card ? { card, slot } : null
}

// Setup: my Active and Benched picks among the Basics in my hand
const setupActive = ref(null)
const setupBench = ref([])

function tapHand(entry) {
  if (busy.value || finished.value) return
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
  if (busy.value || finished.value) return
  if (hints.value.promote) {
    if (pos > 0) act({ type: 'promote', pos })
    return
  }
  select({ kind: 'mine', pos })
}

function tapTheirs(pos) {
  if (pending.value?.need === 'target') return chooseTarget(pos)
  select({ kind: 'theirs', pos })
}

/** The events of my last move (and the server's turn), else the battle's last ones. */
const recent = ref([])
const logLines = computed(() => describeAll(recent.value.length ? recent.value : (battle.value?.log ?? []).slice(-12)))
const logEl = ref(null)

watch(logLines, async () => {
  await nextTick()
  if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight
})

async function act(action) {
  if (busy.value) return
  busy.value = true
  errorMessage.value = ''
  confirmForfeit.value = false
  try {
    const result = await pvp.act(action)
    recent.value = result.events
    pending.value = null
    trainerPick.value = null
    abilityPick.value = null
    // Keep my Pokémon picked while it's still there; a played card leaves the hand
    if (selection.value?.kind !== 'mine' || action.type === 'attack' || action.type === 'end' || action.type === 'retreat') selection.value = null
    playSounds(result.events)
    if (result.battle.status !== 'playing') finished.value = result.battle
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
    const over = events.find((e) => e.k === 'over')
    if (over.winner === 'a') sfx.hit(settings.sound)
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

const chooseTarget = (pos) => chooseStep(pos)

/**
 * Why ability i of my Pokémon at pos can't be used now, null if it can
 * (0033: hints.abilities). Not `?? 'unknown'`: null means usable.
 */
function abilityBlock(pos, i) {
  const list = hints.value.abilities?.[pos] ?? []
  return i < list.length ? list[i] : 'unknown'
}
const abilityName = (ability) => (french.value && ability?.name_fr) || ability?.name || ''

/** A Trainer card's stage line: its kind. */
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
  try {
    const result = await pvp.forfeit()
    finished.value = result.battle
    sfx.buzz(settings.vibration)
  } catch (err) {
    errorMessage.value = errorFor(err)
    if (err?.code === 'no_game') pvp.load()
  } finally {
    busy.value = false
  }
}

function resetBattleUi() {
  selection.value = null
  pending.value = null
  recent.value = []
  setupActive.value = null
  setupBench.value = []
}

function backToLobby() {
  if (finished.value) format.value = finished.value.format
  finished.value = null
  resetBattleUi()
  loadEligible()
}

function scrollToBattle() {
  nextTick(() => battleEl.value?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }))
}

/** @param {string | null} [level] - a bot level, null = a player */
async function fight(level = null) {
  if (busy.value || !(level ? canFightBot.value : canFight.value)) return
  busy.value = true
  errorMessage.value = ''
  finished.value = null
  resetBattleUi()
  try {
    if (level) await pvp.startBot(format.value, level)
    else await pvp.start(format.value)
    scrollToBattle()
  } catch (err) {
    errorMessage.value = errorFor(err)
  } finally {
    busy.value = false
  }
}

const resultTitle = computed(() => (finished.value ? t(`pvp.result.${finished.value.status}`) : ''))
const signed = (n) => (n > 0 ? `+${n}` : String(n ?? 0))
// What retreating costs now (Tools, Trainers: 0032), the printed cost before
const retreatCost = computed(() => hints.value.retreat_cost ?? mySlot(0)?.card.retreat ?? 0)

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
      if (e.flips?.length) text += ` ${t('pvp.ev.flips', { flips: e.flips.map((up) => t(up ? 'pvp.heads' : 'pvp.tails')).join(', ') })}`
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
    case 'trainer': {
      let text = t(`pvp.ev.trainer.${side}`, { name, card })
      if (e.flips?.length) text += ` ${t('pvp.ev.flips', { flips: e.flips.map((up) => t(up ? 'pvp.heads' : 'pvp.tails')).join(', ') })}`
      return text
    }
    case 'search':
    case 'recover': {
      const found = e.cards ?? []
      if (!found.length) return e.k === 'search' ? t(`pvp.ev.searchNone.${side}`, { name }) : ''
      // their cards: only how many (their deck isn't mine to name)
      if (side === 'd') return t(`pvp.ev.${e.k}.d`, { name, count: found.length }, found.length)
      const cards = found.map((i) => cardName(myCard(i))).join(', ')
      return t(e.k === 'search' && e.to === 'bench' ? 'pvp.ev.searchBench.a' : `pvp.ev.${e.k}.a`, { cards })
    }
    case 'ability': {
      let text = t(`pvp.ev.ability.${side}`, { card, ability: (french.value && e.ability_fr) || e.ability || '' })
      if (e.flips?.length) text += ` ${t('pvp.ev.flips', { flips: e.flips.map((up) => t(up ? 'pvp.heads' : 'pvp.tails')).join(', ') })}`
      return text
    }
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

// ---------- Leaderboard ----------

const board = computed(() => pvp.boards[format.value] ?? null)
const boardError = ref(false)

async function loadBoard() {
  boardError.value = false
  try {
    await pvp.loadBoard(format.value)
  } catch {
    boardError.value = true
  }
}

watch(format, () => {
  if (!pvp.loaded || pvp.unavailable) return
  loadBoard()
  if (!battle.value) loadEligible()
})

onMounted(async () => {
  challenge.load() // the header's coins
  await pvp.load()
  if (!pvp.loaded || pvp.unavailable) return
  if (pvp.battle) format.value = pvp.battle.format
  // A remembered format that no longer exists (set renamed, new device)
  else if (!['all', ...eras.value.map((e) => e.format), ...sets.value.map((s) => s.format)].includes(format.value)) format.value = 'all'
  loadBoard()
  if (!pvp.battle) loadEligible()
})
</script>

<template>
  <div class="pb-page">
    <AppHeader />

    <main class="container pvp">
      <header class="pvp-head">
        <h1 class="pvp-title">{{ t('pvp.title') }}</h1>
        <p class="pvp-subtitle">{{ t('pvp.subtitle') }}</p>
      </header>

      <p v-if="pvp.unavailable" class="pvp-note">{{ t('pvp.unavailable') }}</p>
      <div v-else-if="pvp.error" class="alert alert-danger" role="alert">{{ t('pvp.loadError') }}</div>
      <div v-else-if="!pvp.loaded" class="pb-skeleton pvp-skeleton" aria-busy="true"></div>

      <template v-else>
        <div v-if="errorMessage" class="alert alert-danger" role="alert">{{ errorMessage }}</div>

        <!-- ============ A battle ============ -->
        <section v-if="battle" ref="battleEl" class="pvp-battle" aria-labelledby="pvp-battle-title">
          <div class="pvp-battle-head">
            <h2 id="pvp-battle-title" class="pvp-vs">
              {{ t('pvp.vs', { name: opponentName }) }}
              <span v-if="battle.opponent.elo" class="pvp-elo">{{ t('pvp.eloShort', { elo: battle.opponent.elo }) }}</span>
            </h2>
            <span class="pvp-format-chip">{{ formatLabel(battle.format) }}</span>
          </div>

          <dl class="pvp-score">
            <div>
              <dt>{{ t('pvp.myPoints') }}</dt>
              <dd>{{ battle.me.points }} / {{ rules.points }}</dd>
            </div>
            <div>
              <dt class="visually-hidden">{{ t('pvp.turn', { turn: battle.turn, max: rules.turns }) }}</dt>
              <dd aria-hidden="true">{{ t('pvp.turn', { turn: battle.turn, max: rules.turns }) }}</dd>
            </div>
            <div>
              <dt>{{ t('pvp.theirPoints') }}</dt>
              <dd>{{ battle.them.points }} / {{ rules.points }}</dd>
            </div>
          </dl>

          <!-- Their side -->
          <div class="pvp-side is-theirs" role="group" :aria-label="t('pvp.theirSide', { name: opponentName })">
            <div class="pvp-side-head">
              <span class="pvp-side-title">{{ t('pvp.theirSide', { name: opponentName }) }}</span>
              <span class="pvp-chips">
                <span class="pvp-chip">{{ t('pvp.handCount', { count: battle.them.hand_count }) }}</span>
                <span class="pvp-chip">{{ t('pvp.deckLeft', { count: battle.them.deck }) }}</span>
                <span v-if="battle.them.energy_types?.length" class="pvp-chip pvp-zone-chip">
                  {{ t('pvp.energyShort') }} <EnergyIcons :types="battle.them.energy_types" />
                  <template v-if="battle.them.next">· {{ t('pvp.nextEnergy') }} <EnergyIcons :types="[battle.them.next]" /></template>
                </span>
              </span>
            </div>
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
                  <PvpCard :card="theirSlot(n).card" :slot="theirSlot(n)" compact />
                </button>
                <span v-else class="pvp-empty">{{ t('pvp.emptySlot') }}</span>
              </li>
            </ul>
            <div class="pvp-active-row">
              <button
                v-if="theirSlot(0)"
                type="button"
                class="pvp-slot is-active"
                :class="{ 'is-selected': selection?.kind === 'theirs' && selection.pos === 0, 'is-target': pending?.need === 'target' && pending.anyTarget }"
                :aria-label="`${t('pvp.active')}: ${cardName(theirSlot(0).card)}, ${t('pvp.hp', { left: theirSlot(0).hp_left, hp: theirSlot(0).card.hp })}`"
                :disabled="pending?.need === 'target' && !pending.anyTarget"
                @click="tapTheirs(0)"
              >
                <PvpCard :card="theirSlot(0).card" :slot="theirSlot(0)" compact />
              </button>
              <span v-else class="pvp-empty is-active">{{ t('pvp.emptySlot') }}</span>
            </div>
          </div>

          <!-- What happened -->
          <div ref="logEl" class="pvp-log" role="log" aria-live="polite" :aria-label="t('pvp.logTitle')">
            <p v-for="line in logLines" :key="line.key" :class="{ 'is-turn': line.turn }">{{ line.text }}</p>
            <p v-if="busy" class="pvp-muted">{{ t('pvp.waitHint') }}</p>
          </div>

          <!-- My side -->
          <div class="pvp-side is-mine" role="group" :aria-label="t('pvp.mySide')">
            <div class="pvp-active-row">
              <button
                v-if="mySlot(0)"
                type="button"
                class="pvp-slot is-active"
                :class="{ 'is-selected': selection?.kind === 'mine' && selection.pos === 0, 'is-playable': nextStep === 'attach' || nextStep === 'attack' }"
                :aria-label="`${t('pvp.active')}: ${cardName(mySlot(0).card)}, ${t('pvp.hp', { left: mySlot(0).hp_left, hp: mySlot(0).card.hp })}`"
                :disabled="!!finished || hints.promote"
                @click="tapMine(0)"
              >
                <PvpCard :card="mySlot(0).card" :slot="mySlot(0)" compact />
              </button>
              <span v-else-if="hints.setup && setupActive !== null" class="pvp-slot is-active is-setup">
                <PvpCard :card="myCard(setupActive)" compact />
              </span>
              <span v-else class="pvp-empty is-active">{{ hints.setup ? t('pvp.setupActive') : t('pvp.emptySlot') }}</span>
            </div>
            <ul class="pvp-bench" :aria-label="t('pvp.bench')">
              <li v-for="n in benchSize" :key="n">
                <button
                  v-if="mySlot(n)"
                  type="button"
                  class="pvp-slot"
                  :class="{
                    'is-selected': selection?.kind === 'mine' && selection.pos === n,
                    'is-target': hints.promote || pending?.need === 'switch_to' || pending?.need === 'energy_to',
                  }"
                  :aria-label="`${cardName(mySlot(n).card)}, ${t('pvp.hp', { left: mySlot(n).hp_left, hp: mySlot(n).card.hp })}`"
                  :disabled="!!finished"
                  @click="pending?.need === 'switch_to' || pending?.need === 'energy_to' ? chooseStep(n) : tapMine(n)"
                >
                  <PvpCard :card="mySlot(n).card" :slot="mySlot(n)" compact />
                </button>
                <span v-else-if="hints.setup && setupBench[n - 1] !== undefined" class="pvp-slot is-setup">
                  <PvpCard :card="myCard(setupBench[n - 1])" compact />
                </span>
                <span v-else class="pvp-empty">{{ t('pvp.emptySlot') }}</span>
              </li>
            </ul>
          </div>

          <!-- My hand and what I can do: one block, stuck above the tab bar on phones -->
          <div class="pvp-dock">
            <div class="pvp-hand-wrap">
              <p class="pvp-side-title">{{ t('pvp.myHand', { count: battle.me.hand.length }) }}</p>
              <ul class="pvp-hand" :aria-label="t('pvp.myHand', { count: battle.me.hand.length })">
                <li v-for="entry in battle.me.hand" :key="entry.index">
                  <button
                    type="button"
                    class="pvp-slot"
                    :class="{
                      'is-selected': (selection?.kind === 'hand' && selection.index === entry.index) || setupActive === entry.index || setupBench.includes(entry.index),
                      'is-playable': hints.setup ? entry.card.stage === 'basic' : handPlayable(entry),
                    }"
                    :aria-label="cardName(entry.card)"
                    :aria-pressed="setupActive === entry.index || setupBench.includes(entry.index)"
                    :disabled="!!finished"
                    @click="tapHand(entry)"
                  >
                    <PvpCard :card="entry.card" compact />
                  </button>
                </li>
              </ul>
            </div>

            <!-- What I can do -->
            <div class="pvp-panel-actions">
              <template v-if="finished">
                <p class="pvp-feedback" role="status">
                  <strong :class="finished.status === 'won' ? 'pvp-good' : finished.status === 'draw' ? '' : 'pvp-bad'">{{ resultTitle }}</strong>
                  <span v-if="!finished.bot">{{ t('pvp.eloChange', { change: signed(finished.elo_change) }) }}</span>
                  <span v-else-if="finished.coins" class="pvp-coins-won">{{ t('pvp.coinsWon') }} <CoinAmount :amount="finished.coins" signed /></span>
                  <span v-else>{{ t(finished.paid ? 'pvp.noCoins' : 'pvp.unpaid') }}</span>
                </p>
                <button type="button" class="btn btn-primary glow-button" @click="backToLobby">{{ t('pvp.back') }}</button>
              </template>

              <template v-else-if="hints.setup">
                <p class="pvp-panel-title">{{ t('pvp.setupTitle') }}</p>
                <p class="pvp-note">{{ t('pvp.setupHelp') }}</p>
                <button type="button" class="btn btn-primary glow-button" :disabled="busy || setupActive === null" @click="startBattle">
                  {{ t('pvp.setupStart') }}
                </button>
              </template>

              <template v-else-if="hints.promote">
                <p class="pvp-panel-title">{{ t('pvp.promoteTitle') }}</p>
                <p class="pvp-note">{{ t('pvp.promoteHelp') }}</p>
              </template>

              <template v-else-if="trainerPick !== null || abilityPick">
                <PvpTrainerPicker
                  :battle="battle"
                  :index="trainerPick ?? -1"
                  :ability="abilityPick"
                  @play="act"
                  @cancel="(trainerPick = null), (abilityPick = null)"
                />
              </template>

              <template v-else-if="pending?.need">
                <p class="pvp-panel-title">{{ t(pending.need === 'target' ? 'pvp.pickTarget' : pending.need === 'switch_to' ? 'pvp.pickSwitch' : 'pvp.pickEnergyTo') }}</p>
                <div class="pvp-choice-buttons">
                  <template v-if="pending.need === 'target'">
                    <button v-if="pending.anyTarget && theirSlot(0)" type="button" class="pvp-choice" @click="chooseStep(0)">{{ cardName(theirSlot(0).card) }}</button>
                    <button v-for="n in battle.them.bench.length" :key="n" type="button" class="pvp-choice" @click="chooseStep(n)">{{ cardName(theirSlot(n).card) }}</button>
                  </template>
                  <template v-else>
                    <button v-for="n in battle.me.bench.length" :key="n" type="button" class="pvp-choice" @click="chooseStep(n)">{{ cardName(mySlot(n).card) }}</button>
                  </template>
                  <button type="button" class="btn btn-outline-secondary btn-sm" @click="pending = null">{{ t('pvp.cancel') }}</button>
                </div>
              </template>

              <template v-else-if="selectedCard">
                <div class="pvp-panel-head">
                  <p class="pvp-panel-title">{{ cardName(selectedCard) }}</p>
                  <button type="button" class="btn btn-outline-secondary btn-sm" @click="openSheet(selectedCard, selectedSlot)">{{ t('pvp.details') }}</button>
                </div>
                <!-- A card in my hand -->
                <div v-if="selection.kind === 'hand' && selectedCard.stage === 'trainer'" class="pvp-choice-buttons">
                  <button v-if="handHints?.play === null" type="button" class="pvp-choice" :disabled="busy" @click="trainerPick = selection.index">
                    {{ t('pvp.play') }}
                  </button>
                  <p v-else class="pvp-note">{{ t(`pvp.playBlocks.${handHints?.play ?? 'unknown'}`) }}</p>
                </div>
                <div v-else-if="selection.kind === 'hand'" class="pvp-choice-buttons">
                  <button v-if="handHints?.bench" type="button" class="pvp-choice" :disabled="busy" @click="act({ type: 'bench', card: selection.index })">
                    {{ t('pvp.toBench') }}
                  </button>
                  <button
                    v-for="pos in handHints?.evolve ?? []"
                    :key="pos"
                    type="button"
                    class="pvp-choice"
                    :disabled="busy"
                    @click="act({ type: 'evolve', card: selection.index, pos })"
                  >
                    {{ t('pvp.evolveOnto', { name: cardName(mySlot(pos).card) }) }}
                  </button>
                </div>
                <!-- One of my Pokémon -->
                <div v-else-if="selection.kind === 'mine'" class="pvp-choice-buttons">
                  <button v-if="hints.attach" type="button" class="pvp-choice" :disabled="busy" @click="act({ type: 'attach', pos: selection.pos })">
                    <EnergyIcons v-if="myZone" :types="[myZone]" />
                    {{ myZone ? t('pvp.attachType', { type: typeLabel(myZone) }) : t('pvp.attach') }}
                  </button>
                  <button
                    v-if="selection.pos > 0 && hints.retreat"
                    type="button"
                    class="pvp-choice"
                    :disabled="busy"
                    @click="act({ type: 'retreat', pos: selection.pos })"
                  >
                    {{
                      t('pvp.retreatHere', {
                        name: cardName(mySlot(0).card),
                        cost: retreatCost ? t('pvp.energyCount', { count: retreatCost }, retreatCost) : t('pvp.free'),
                      })
                    }}
                  </button>
                </div>
                <!-- Its abilities (0033) -->
                <ul v-if="selection.kind === 'mine' && selectedCard.abilities?.length" class="pvp-abilities" :aria-label="t('pvp.ability')">
                  <li v-for="(ability, i) in selectedCard.abilities" :key="i">
                    <button
                      v-if="abilityBlock(selection.pos, i) === null"
                      type="button"
                      class="pvp-choice"
                      :disabled="busy"
                      @click="abilityPick = { at: selection.pos, i }"
                    >
                      {{ t('pvp.useAbility', { name: abilityName(ability) }) }}
                    </button>
                    <p v-else class="pvp-note">
                      <strong>{{ abilityName(ability) }}</strong> · {{ t(`pvp.abilityBlocks.${abilityBlock(selection.pos, i)}`) }}
                    </p>
                  </li>
                </ul>
              </template>

              <!-- Nothing picked on my turn: what to do now, and the shortest way (Pocket-like: attach, attack) -->
              <template v-else-if="myTurn">
                <p class="pvp-panel-title pvp-next" role="status">{{ t(`pvp.next.${nextStep}`) }}</p>
                <div v-if="hints.attach && mySlot(0)" class="pvp-choice-buttons">
                  <button type="button" class="pvp-choice" :disabled="busy" @click="act({ type: 'attach', pos: 0 })">
                    <EnergyIcons v-if="myZone" :types="[myZone]" />
                    {{ myZone ? t('pvp.attachTypeTo', { type: typeLabel(myZone), name: cardName(mySlot(0).card) }) : t('pvp.attach') }}
                  </button>
                </div>
              </template>

              <!-- My Active's attacks: picked, or nothing picked on my turn -->
              <div v-if="showAttacks" class="pvp-attack-buttons" role="group" :aria-label="t('pvp.attacks')">
                <button
                  v-for="(attack, i) in mySlot(0).card.attacks"
                  :key="i"
                  type="button"
                  class="pvp-attack-button"
                  :disabled="busy || attackBlock(i) !== null"
                  @click="useAttack(i)"
                >
                  <EnergyIcons class="pvp-attack-cost" :types="attack.energy ?? []" :count="attack.cost" free />
                  <span class="pvp-attack-title">
                    {{ attackName(attack, french) }}
                    <small v-if="attackBlock(i)">{{ t(`pvp.blocks.${attackBlock(i)}`) }}</small>
                  </span>
                  <strong>{{ damageLabel(attack) }}</strong>
                </button>
              </div>
              <p v-if="myTurn && !selection && !pending?.need && trainerPick === null && !abilityPick" class="pvp-note pvp-hint">{{ t('pvp.selectHint') }}</p>

              <div v-if="!finished && !hints.setup" class="pvp-turn-bar">
                <span class="pvp-energy-line">
                  <EnergyIcons v-if="hints.attach && myZone" :types="[myZone]" />
                  <span class="pvp-energy-text">{{ energyLine }}</span>
                  <span v-if="battle.me.next && !battle.winner" class="pvp-energy-next">· {{ t('pvp.nextEnergy') }} <EnergyIcons :types="[battle.me.next]" /></span>
                </span>
                <button
                  type="button"
                  class="btn"
                  :class="nextStep === 'end' || nextStep === 'play' ? 'btn-primary glow-button' : 'btn-outline-secondary'"
                  :disabled="busy || !myTurn || !!pending"
                  @click="act({ type: 'end' })"
                >
                  {{ t('pvp.endTurn') }}
                </button>
              </div>
            </div>
          </div>

          <div v-if="!finished" class="pvp-actions">
            <button type="button" class="btn btn-sm" :class="confirmForfeit ? 'btn-danger' : 'btn-outline-secondary'" :disabled="busy" @click="forfeit">
              {{ confirmForfeit ? t('pvp.forfeitConfirm') : t('pvp.forfeit') }}
            </button>
          </div>
        </section>

        <!-- ============ Lobby: format, decks, fight ============ -->
        <section v-else class="pvp-lobby" aria-labelledby="pvp-lobby-title">
          <h2 id="pvp-lobby-title" class="pb-section-title">{{ t('pvp.formatTitle') }}</h2>
          <div class="pvp-kinds" role="tablist" :aria-label="t('pvp.formatTitle')">
            <button
              v-for="item in KINDS"
              :key="item"
              type="button"
              role="tab"
              :aria-selected="kind === item"
              :class="{ active: kind === item }"
              @click="pickKind(item)"
            >
              {{ t(`pvp.kinds.${item}`) }}
            </button>
          </div>
          <div v-if="kind === 'era'" class="pvp-select">
            <label for="pvp-era">{{ t('pvp.pickEra') }}</label>
            <select id="pvp-era" class="form-select" :value="format" @change="pickFormat">
              <option v-for="era in eras" :key="era.format" :value="era.format">
                {{ t('pvp.optionCount', { name: era.series, count: era.owned }, era.owned) }}
              </option>
            </select>
          </div>
          <div v-else-if="kind === 'set'" class="pvp-select">
            <label for="pvp-set">{{ t('pvp.pickSet') }}</label>
            <select v-if="sets.length" id="pvp-set" class="form-select" :value="format" @change="pickFormat">
              <option v-for="set in sets" :key="set.format" :value="set.format">
                {{ t('pvp.optionCount', { name: setName(set), count: set.owned }, set.owned) }}
              </option>
            </select>
            <span v-else class="pvp-note">{{ t('pvp.noSets') }}</span>
          </div>
          <p class="pvp-note">{{ t(`pvp.kindHelp.${kind}`) }}</p>

          <dl class="pvp-stats">
            <div>
              <dt>{{ t('pvp.elo') }}</dt>
              <dd>{{ rating?.elo ?? pvp.state.start_elo }}</dd>
            </div>
            <div>
              <dt>{{ t('pvp.record') }}</dt>
              <dd>{{ t('pvp.recordValue', myRecord) }}</dd>
            </div>
            <div>
              <dt>{{ t('pvp.winRate') }}</dt>
              <dd>{{ myRecord.rate === null ? '-' : `${myRecord.rate}%` }}</dd>
            </div>
          </dl>

          <!-- Deck builder -->
          <div v-if="building" class="pvp-builder">
            <div class="pvp-builder-head">
              <h3 class="pvp-side-title">{{ t(`pvp.buildTitle.${building}`, { format: formatLabel(format) }) }}</h3>
              <span class="pvp-count" :class="{ full: check.ready }">{{ picks.length }} / {{ rules.deck }}</span>
            </div>
            <p class="pvp-note">{{ t(`pvp.buildHelp.${building}`) }}</p>

            <fieldset class="pvp-energy-pick">
              <legend class="pvp-side-title">{{ t('pvp.energyTitle') }}</legend>
              <p class="pvp-note">{{ t('pvp.energyHelp', { max: maxEnergy }) }}</p>
              <div class="pvp-energy-types">
                <button
                  v-for="type in energyTypes"
                  :key="type"
                  type="button"
                  :aria-pressed="energy.includes(type)"
                  :class="{ active: energy.includes(type) }"
                  @click="toggleEnergy(type)"
                >
                  <span class="pvp-type-dot" :style="{ '--dot': `var(--pb-type-${type.toLowerCase()})` }" aria-hidden="true"></span>
                  {{ typeLabel(type) }}
                </button>
              </div>
              <p v-if="!energy.length" class="pvp-warning" role="alert">{{ t('pvp.energyNone') }}</p>
            </fieldset>

            <div class="pvp-deck-list" role="group" :aria-label="t(`pvp.deckTitle.${building}`)">
              <p v-if="!picks.length" class="pvp-note">{{ t('pvp.deckEmpty') }}</p>
              <ul v-else class="pvp-deck-lines">
                <li v-for="entry in pickedGroups" :key="entry.id">
                  <button type="button" class="pvp-line-button" :aria-label="t('pvp.remove', { name: cardName(entry.card) })" @click="removePick(entry.id)">−</button>
                  <span class="pvp-line-count">{{ entry.count }}×</span>
                  <span class="pvp-line-name">{{ cardName(entry.card) }}</span>
                  <span class="pvp-muted pvp-line-stage">{{ stageLabel(entry.card) }}</span>
                </li>
              </ul>
              <p v-if="check.missing" class="pvp-note">{{ t('pvp.missing', { count: check.missing }, check.missing) }}</p>
              <p v-if="picks.length && !check.basics" class="pvp-warning" role="alert">{{ t('pvp.noBasic') }}</p>
              <p v-if="check.orphans.length" class="pvp-note pvp-warn-text">{{ t('pvp.orphans', { names: check.orphans.join(', ') }) }}</p>
              <p v-if="check.unpaid.length" class="pvp-note pvp-warn-text">{{ t('pvp.unpaid', { names: check.unpaid.join(', '), types: typeList(energy) }) }}</p>
            </div>

            <div class="pvp-actions">
              <button type="button" class="btn btn-primary" :disabled="busy || !check.ready" @click="saveDeck">{{ t('pvp.saveDeck') }}</button>
              <button type="button" class="btn btn-outline-secondary" :disabled="busy || eligibleLoading || !eligible.length" @click="autoBuild(building)">
                {{ t('pvp.autoDeck') }}
              </button>
              <button type="button" class="btn btn-outline-secondary" :disabled="busy || !picks.length" @click="picks = []">{{ t('pvp.clear') }}</button>
              <button type="button" class="btn btn-outline-secondary" :disabled="busy" @click="building = null">{{ t('pvp.cancel') }}</button>
            </div>

            <div class="pvp-filters">
              <input v-model="search" type="search" class="form-control" :placeholder="t('pvp.search')" :aria-label="t('pvp.search')" />
              <div class="pvp-kinds" role="group" :aria-label="t('pvp.search')">
                <button v-for="item in FILTERS" :key="item" type="button" :aria-pressed="filter === item" :class="{ active: filter === item }" @click="filter = item">
                  {{ t(`pvp.filter.${item}`) }}
                </button>
              </div>
            </div>
            <div v-if="eligibleLoading" class="pb-skeleton pvp-builder-skeleton" aria-busy="true"></div>
            <p v-else-if="ownedHere < rules.deck" class="pvp-note">
              {{ t('pvp.notEnough', { count: ownedHere, deck: rules.deck }, ownedHere) }}
              <RouterLink :to="{ name: 'challenge-boosters' }">{{ t('pvp.openBoosters') }}</RouterLink>
            </p>
            <ul v-if="!eligibleLoading && shown.length" class="pvp-grid">
              <li v-for="card in shown" :key="card.id">
                <div class="pvp-pick" :class="{ 'is-picked': counts.get(card.id), 'is-off': card.stage !== 'trainer' && energy.length && !fitsEnergy(card, energy) }">
                  <button type="button" class="pvp-pick-card" :aria-label="t('pvp.details')" @click="openSheet(card)">
                    <PvpCard :card="card" />
                  </button>
                  <div class="pvp-pick-row">
                    <button
                      type="button"
                      class="pvp-line-button"
                      :aria-label="t('pvp.remove', { name: cardName(card) })"
                      :disabled="!counts.get(card.id)"
                      @click="removePick(card.id)"
                    >
                      −
                    </button>
                    <span class="pvp-pick-count">{{ counts.get(card.id) ?? 0 }} / {{ Math.min(card.owned, 2) }}</span>
                    <button
                      type="button"
                      class="pvp-line-button"
                      :aria-label="t('pvp.add', { name: cardName(card) })"
                      :title="addBlock(picks, card, eligibleById, rules.deck) ? t(`pvp.blocked.${addBlock(picks, card, eligibleById, rules.deck)}`) : null"
                      :disabled="!!addBlock(picks, card, eligibleById, rules.deck)"
                      @click="addPick(card)"
                    >
                      +
                    </button>
                  </div>
                  <span v-if="card.stage !== 'trainer' && energy.length && !fitsEnergy(card, energy)" class="pvp-muted pvp-off-note">{{ t('pvp.notPaid') }}</span>
                </div>
              </li>
            </ul>
          </div>

          <!-- Saved decks: attack, defense -->
          <div v-else class="pvp-decks">
            <div v-for="role in DECK_ROLES" :key="role" class="pvp-deck" role="group" :aria-labelledby="`pvp-deck-${role}`">
              <div class="pvp-builder-head">
                <h3 :id="`pvp-deck-${role}`" class="pvp-side-title">{{ t(`pvp.deckTitle.${role}`) }}</h3>
                <div class="pvp-deck-buttons">
                  <button type="button" class="btn btn-outline-secondary btn-sm" :disabled="ownedHere < rules.deck" @click="editDeck(role, { auto: true })">
                    {{ t('pvp.autoDeck') }}
                  </button>
                  <button type="button" class="btn btn-outline-secondary btn-sm" @click="editDeck(role)">
                    {{ decks[role] ? t('pvp.editDeck') : t('pvp.buildDeck') }}
                  </button>
                </div>
              </div>
              <template v-if="decks[role]">
                <p v-if="!decks[role].valid" class="pvp-warning" role="alert">
                  {{ t(role === 'defense' && decks.attack?.valid ? 'pvp.defenseInvalid' : 'pvp.deckInvalid') }}
                </p>
                <p v-if="decks[role].energy?.length" class="pvp-note pvp-deck-energy">
                  {{ t('pvp.energyShort') }} <EnergyIcons :types="decks[role].energy" /> {{ typeList(decks[role].energy) }}
                  <span v-if="decks[role].energy_auto" class="pvp-muted">({{ t('pvp.energyAuto') }})</span>
                </p>
                <ul v-if="grouped(decks[role].ids).length" class="pvp-deck-lines is-summary">
                  <li v-for="entry in grouped(decks[role].ids)" :key="entry.id">
                    <span class="pvp-line-count">{{ entry.count }}×</span>
                    <span class="pvp-line-name">{{ cardName(entry.card) }}</span>
                  </li>
                </ul>
                <p class="pvp-note">{{ t(`pvp.deckRole.${role}`) }}</p>
              </template>
              <p v-else-if="role === 'defense' && decks.attack" class="pvp-note">{{ t('pvp.defenseFallback') }}</p>
              <p v-else class="pvp-note">{{ t('pvp.noDeck', { count: ownedHere, deck: rules.deck }, ownedHere) }}</p>
            </div>
          </div>

          <div class="pvp-start">
            <button type="button" class="btn btn-primary btn-lg glow-button" :disabled="busy || !canFight" @click="fight()">{{ t('pvp.fight') }}</button>
            <p class="pvp-note">
              {{ pvp.battlesLeft ? t('pvp.battlesLeftLine', { count: pvp.battlesLeft }, pvp.battlesLeft) : t('pvp.noBattlesLeft') }}
            </p>
          </div>

          <!-- Bots: the same battle, for coins -->
          <div class="pvp-bots" role="group" aria-labelledby="pvp-bots-title">
            <h3 id="pvp-bots-title" class="pvp-side-title">{{ t('pvp.botsTitle') }}</h3>
            <p class="pvp-note">{{ t('pvp.botsHelp') }}</p>
            <div class="pvp-bot-buttons">
              <button
                v-for="level in BOT_LEVELS"
                :key="level"
                type="button"
                class="pvp-bot-button"
                :disabled="busy || !canFightBot"
                @click="fight(level)"
              >
                <span class="pvp-attack-title">{{ t(`pvp.levels.${level}`) }}</span>
                <span v-if="pvp.botPaidLeft" class="pvp-bot-reward">{{ t('pvp.botWin') }} <CoinAmount :amount="rules.botCoins[level] ?? 0" /></span>
              </button>
            </div>
            <p class="pvp-note">
              <template v-if="!pvp.botBattlesLeft">{{ t('pvp.noBotBattlesLeft') }}</template>
              <template v-else-if="pvp.botPaidLeft">{{ t('pvp.botPaidLeft', { count: pvp.botPaidLeft }, pvp.botPaidLeft) }}</template>
              <template v-else>{{ t('pvp.botUnpaidLeft', { count: pvp.botBattlesLeft }, pvp.botBattlesLeft) }}</template>
            </p>
          </div>
        </section>

        <!-- ============ History ============ -->
        <section class="pvp-panel" aria-labelledby="pvp-history-title">
          <h2 id="pvp-history-title" class="pb-section-title">{{ t('pvp.historyTitle') }}</h2>
          <ul v-if="pvp.history.length" class="pvp-history">
            <li v-for="entry in pvp.history" :key="entry.id">
              <span class="pvp-result" :class="`is-${entry.result}`">{{ t(`pvp.short.${entry.result}`) }}</span>
              <span class="pvp-history-text">
                <template v-if="entry.bot">{{ t('pvp.history.bot', { name: botName(entry.bot) }) }}</template>
                <template v-else>{{ t(`pvp.history.${entry.role}`, { name: entry.opponent ?? t('pvp.privateTrainer') }) }}</template>
                <span class="pvp-muted">{{ formatLabel(entry.format) }}</span>
              </span>
              <strong v-if="entry.bot" class="pvp-change"><CoinAmount v-if="entry.coins" :amount="entry.coins" signed /></strong>
              <strong v-else class="pvp-change">{{ signed(entry.elo_change) }}</strong>
            </li>
          </ul>
          <p v-else class="pvp-note">{{ t('pvp.noHistory') }}</p>
        </section>

        <!-- ============ Leaderboard ============ -->
        <section class="pvp-panel" aria-labelledby="pvp-board-title">
          <h2 id="pvp-board-title" class="pb-section-title">{{ t('pvp.boardTitle', { format: formatLabel(format) }) }}</h2>
          <p v-if="boardError" class="pvp-note">{{ t('pvp.boardError') }}</p>
          <div v-else-if="!board" class="pb-skeleton pvp-board-skeleton" aria-busy="true"></div>
          <template v-else>
            <ol v-if="board.rows.length" class="pvp-board">
              <li v-for="row in board.rows" :key="row.rank">
                <span class="pvp-rank">{{ row.rank }}</span>
                <RouterLink :to="{ name: 'public-profile', params: { username: row.username } }" class="pvp-board-name">{{ row.username }}</RouterLink>
                <span class="pvp-muted">{{ t('pvp.recordValue', record(row)) }}</span>
                <strong>{{ row.elo }}</strong>
              </li>
            </ol>
            <p v-else class="pvp-note">{{ t('pvp.boardEmpty') }}</p>
            <p v-if="board.me" class="pvp-note">{{ t('pvp.myRank', { rank: board.me.rank, elo: board.me.elo }) }}</p>
          </template>
        </section>

        <!-- ============ Rules ============ -->
        <section class="pvp-panel pvp-rules" aria-labelledby="pvp-rules-title">
          <h2 id="pvp-rules-title" class="pvp-rules-title">{{ t('minigame.rulesTitle') }}</h2>
          <ul>
            <li>{{ t('pvp.rules.deck') }}</li>
            <li>{{ t('pvp.rules.setup') }}</li>
            <li>{{ t('pvp.rules.turn') }}</li>
            <li>{{ t('pvp.rules.evolve') }}</li>
            <li>{{ t('pvp.rules.retreat') }}</li>
            <li>{{ t('pvp.rules.attack', { resistance: rules.resistance }) }}</li>
            <li>{{ t('pvp.rules.trainers') }}</li>
            <li>{{ t('pvp.rules.abilities') }}</li>
            <li>{{ t('pvp.rules.conditions') }}</li>
            <li>{{ t('pvp.rules.points', { points: rules.points, turns: rules.turns }) }}</li>
            <li>{{ t('pvp.rules.hidden') }}</li>
            <li>{{ t('pvp.rules.elo') }}</li>
            <li>{{ t('pvp.rules.limit', { count: rules.battles, time: resetTime }) }}</li>
            <li>
              {{ t('pvp.rules.bots', { easy: rules.botCoins.easy, normal: rules.botCoins.normal, hard: rules.botCoins.hard, paid: rules.botPaid, count: rules.botBattles }) }}
            </li>
          </ul>
        </section>
      </template>

      <RouterLink :to="{ name: 'challenge-games' }" class="pvp-back"><span aria-hidden="true">←</span> {{ t('games.back') }}</RouterLink>
      <PvpCardSheet :card="sheet?.card ?? null" :slot="sheet?.slot ?? null" @close="sheet = null" />
    </main>
  </div>
</template>

<style scoped>
.pvp {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding-top: 1rem;
  min-width: 0;
}

.pvp-head {
  animation: pb-rise 0.6s var(--pb-ease-out) both;
}

.pvp-title {
  margin: 0 0 0.5rem;
  font-size: clamp(1.8rem, 5vw, 2.8rem);
  font-weight: 800;
}

.pvp-subtitle,
.pvp-note,
.pvp-muted {
  margin: 0;
  color: var(--pb-text-muted);
}

.pvp-skeleton {
  height: 420px;
  border-radius: var(--pb-radius-lg);
}

.pvp-battle,
.pvp-lobby,
.pvp-panel {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
  padding: 1.25rem;
  border-radius: var(--pb-radius-lg);
  border: 1px solid var(--pb-border);
  background: var(--pb-surface);
}

.pvp-battle {
  scroll-margin-top: 0.75rem;
  padding: 0.75rem;
  box-shadow: var(--pb-shadow-card);
}

@media (min-width: 576px) {
  .pvp-battle {
    padding: 1.25rem;
  }
}

.pvp-battle-head,
.pvp-builder-head,
.pvp-side-head,
.pvp-panel-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.pvp-vs {
  margin: 0;
  font-size: 1.2rem;
  font-weight: 800;
  overflow-wrap: anywhere;
}

.pvp-elo {
  margin-left: 0.35rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--pb-text-muted);
}

.pvp-format-chip,
.pvp-chip {
  padding: 0.15rem 0.6rem;
  border-radius: 999px;
  border: 1px solid var(--pb-border-strong);
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--pb-text-muted);
}

.pvp-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.pvp-score,
.pvp-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
  margin: 0;
}

.pvp-score > div,
.pvp-stats > div {
  min-width: 0;
  padding: 0.5rem 0.6rem;
  border-radius: var(--pb-radius-md);
  border: 1px solid var(--pb-border);
  background: var(--pb-bg-elevated);
}

.pvp-score dt,
.pvp-stats dt {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--pb-text-muted);
}

.pvp-score dd,
.pvp-stats dd {
  margin: 0.2rem 0 0;
  font-family: var(--pb-font-display);
  font-size: 1rem;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.pvp-side-title,
.pvp-panel-title {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 700;
  overflow-wrap: anywhere;
}

/* ----- Board ----- */

.pvp-side {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
  padding: 0.6rem;
  border-radius: var(--pb-radius-md);
  border: 1px solid var(--pb-border);
  background: var(--pb-bg-elevated);
}

.pvp-side.is-mine {
  border-color: var(--pb-border-strong);
}

.pvp-bench {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
  max-width: 20rem;
  width: 100%;
  margin: 0 auto;
  padding: 0;
  list-style: none;
}

.pvp-bench > li {
  min-width: 0;
}

.pvp-active-row {
  display: flex;
  justify-content: center;
}

/* After .pvp-slot's width: 100% would win otherwise */
.pvp-active-row > .pvp-slot,
.pvp-active-row > .pvp-empty {
  width: min(8.5rem, 40%);
}

.pvp-slot {
  position: relative;
  display: block;
  width: 100%;
  padding: 0.25rem;
  border-radius: var(--pb-radius-md);
  border: 2px solid var(--pb-border-strong);
  background: var(--pb-surface);
  color: var(--pb-text);
  cursor: pointer;
  text-align: left;
  transition:
    transform 0.2s var(--pb-ease-out),
    border-color 0.2s;
}

.pvp-slot.is-setup {
  cursor: default;
  border-style: dashed;
}

.pvp-slot:disabled {
  cursor: default;
}

.pvp-slot.is-selected {
  border-color: var(--pb-accent);
  box-shadow: 0 0 0 2px var(--pb-accent);
}

.pvp-slot.is-target {
  border-color: var(--pb-ring);
  box-shadow: 0 0 0 2px var(--pb-ring);
}

.pvp-slot.is-playable:not(.is-selected) {
  border-color: var(--pb-ring);
}

.pvp-slot:focus-visible {
  outline: 2px solid var(--pb-focus);
  outline-offset: 2px;
}

@media (hover: hover) {
  .pvp-slot:not(:disabled):not(.is-setup):hover {
    transform: translateY(-2px);
  }
}

.pvp-empty {
  display: grid;
  place-items: center;
  aspect-ratio: 245 / 342;
  border-radius: var(--pb-radius-md);
  border: 2px dashed var(--pb-border);
  color: var(--pb-text-muted);
  font-size: 0.7rem;
  font-weight: 700;
}

.pvp-log {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  max-height: 9rem;
  min-height: 3rem;
  overflow-y: auto;
  padding: 0.5rem 0.75rem;
  border-radius: var(--pb-radius-md);
  background: var(--pb-input-bg);
  font-size: 0.82rem;
}

.pvp-log p {
  margin: 0;
}

/* "a bot (Easy) draws a card." starts a line */
.pvp-log p::first-letter,
.pvp-side-head .pvp-side-title::first-letter {
  text-transform: uppercase;
}

.pvp-side-head .pvp-side-title {
  display: block;
}

.pvp-log p.is-turn {
  margin-top: 0.3rem;
  font-weight: 800;
}

.pvp-hand-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  min-width: 0;
}

/* The hand scrolls sideways inside its own box, never the page */
.pvp-hand {
  display: flex;
  gap: 0.5rem;
  margin: 0;
  padding: 0.25rem 0.1rem 0.5rem;
  list-style: none;
  overflow-x: auto;
  min-width: 0;
}

.pvp-hand > li {
  flex: none;
  width: 5.75rem;
}

.pvp-panel-actions {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.75rem;
  border-radius: var(--pb-radius-md);
  border: 1px solid var(--pb-border-strong);
  background: var(--pb-bg-elevated);
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
  border: 2px solid var(--pb-accent);
  background: var(--pb-surface);
  color: var(--pb-text);
  font-weight: 700;
  overflow-wrap: anywhere;
}

.pvp-choice:disabled {
  opacity: 0.5;
}

.pvp-choice:focus-visible {
  outline: 2px solid var(--pb-focus);
  outline-offset: 2px;
}

.pvp-attack-buttons {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 13rem), 1fr));
  gap: 0.5rem;
}

.pvp-attack-button {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  padding: 0.55rem 0.75rem;
  border-radius: var(--pb-radius-md);
  border: 2px solid var(--pb-border-strong);
  background: var(--pb-surface);
  color: var(--pb-text);
  font-weight: 700;
  text-align: left;
}

.pvp-attack-button:not(:disabled) {
  border-color: var(--pb-accent);
}

.pvp-attack-button:disabled {
  opacity: 0.6;
}

.pvp-attack-button:focus-visible {
  outline: 2px solid var(--pb-focus);
  outline-offset: 2px;
}

@media (hover: hover) {
  .pvp-attack-button:not(:disabled):hover,
  .pvp-choice:not(:disabled):hover {
    background: var(--pb-bg-elevated);
  }
}

.pvp-attack-cost {
  flex: none;
  flex-wrap: nowrap;
  padding: 0.15rem 0.4rem;
  border-radius: 999px;
  background: var(--pb-input-bg);
}

.pvp-attack-title {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.pvp-attack-title small {
  font-weight: 600;
  color: var(--pb-text-muted);
}

.pvp-turn-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--pb-border);
}

.pvp-energy-line {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem;
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--pb-text-muted);
}

.pvp-hint {
  text-align: center;
}

.pvp-feedback {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.25rem 0.75rem;
  margin: 0;
  color: var(--pb-text-muted);
  text-align: center;
}

.pvp-good {
  color: var(--pb-success-text);
}

.pvp-bad {
  color: var(--pb-danger-text);
}

.pvp-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5rem;
}

.pvp-next {
  font-size: 0.85rem;
}

.pvp-dock {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
}

/* Phones and tablets (the tab bar's widths): one screen, like Pocket (user,
   2026-10-06: the board took 3 screens, the actions showed far below the
   card just tapped). Each side is one row (Active, then the Bench), the
   cards cropped to their top (name, HP, art), and my hand + the actions
   stick above the tab bar as one block. */
@media (max-width: 991.98px) {
  .pvp-battle {
    gap: 0.4rem;
    padding: 0.5rem;
  }

  .pvp-vs {
    font-size: 1rem;
  }

  .pvp-score > div {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: center;
    gap: 0 0.35rem;
    padding: 0.1rem 0.4rem;
  }

  .pvp-score dt {
    font-size: 0.7rem;
  }

  .pvp-score dd {
    margin: 0;
    font-size: 0.9rem;
  }

  .pvp-side {
    display: grid;
    grid-template-columns: minmax(0, 1.3fr) minmax(0, 3fr);
    align-items: end;
    gap: 0.4rem;
    padding: 0.4rem;
  }

  .pvp-side-head {
    grid-column: 1 / -1;
  }

  /* The battle's title already names them; the chips stay */
  .pvp-side-head > .pvp-side-title {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  .pvp-side-head .pvp-chip {
    font-size: 0.68rem;
  }

  .pvp-side > .pvp-active-row {
    grid-column: 1;
    grid-row: 2;
  }

  .pvp-side > .pvp-bench {
    grid-column: 2;
    grid-row: 2;
    max-width: none;
    gap: 0.3rem;
  }

  .pvp-active-row > .pvp-slot,
  .pvp-active-row > .pvp-empty {
    width: 100%;
  }

  .pvp-slot {
    padding: 0.15rem;
  }

  .pvp-battle :deep(.pvp-img),
  .pvp-battle .pvp-empty {
    aspect-ratio: 245 / 150;
    object-position: top center;
  }

  .pvp-log {
    max-height: 2.6rem;
    min-height: 0;
    padding: 0.3rem 0.6rem;
    font-size: 0.78rem;
  }

  .pvp-dock {
    gap: 0.4rem;
    padding: 0.4rem 0.5rem;
    border-radius: var(--pb-radius-md);
    border: 1px solid var(--pb-border-strong);
    background: var(--pb-bg-elevated);
  }

  .pvp-dock > .pvp-panel-actions {
    gap: 0.45rem;
    padding: 0;
    border: none;
  }

  .pvp-hand-wrap {
    gap: 0.2rem;
  }

  /* The list is named for screen readers; the cards speak for themselves */
  .pvp-hand-wrap > .pvp-side-title {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  .pvp-hand {
    padding-bottom: 0.25rem;
  }

  .pvp-hand > li {
    width: 4.25rem;
  }

  /* In hand: the art and the name (the details are a tap away) */
  .pvp-hand :deep(.pvp-hp-text) {
    display: none;
  }

  .pvp-hand :deep(.pvp-name) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* One line per attack: why it's blocked sits beside its name */
  .pvp-attack-buttons {
    grid-template-columns: minmax(0, 1fr);
    gap: 0.3rem;
  }

  .pvp-attack-button {
    gap: 0.4rem;
    padding: 0.3rem 0.6rem;
  }

  .pvp-attack-title {
    flex-direction: row;
    align-items: baseline;
    gap: 0.4rem;
    white-space: nowrap;
  }

  .pvp-attack-title small {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 0.72rem;
  }

  .pvp-next {
    font-size: 0.8rem;
  }

  /* The guidance line says it already */
  .pvp-panel-actions .pvp-hint {
    display: none;
  }

  .pvp-turn-bar {
    flex-wrap: nowrap;
    padding-top: 0.4rem;
  }

  .pvp-energy-line {
    flex-wrap: nowrap;
    min-width: 0;
    font-size: 0.75rem;
  }

  .pvp-energy-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pvp-energy-next {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 0.3rem;
  }

  .pvp-turn-bar .btn {
    flex: none;
    padding: 0.35rem 0.8rem;
  }
}

/* Tall enough for the whole board and the dock: the dock sticks above the
   tab bar. On short screens (375x667) it covered the whole board: it stays
   in place there, a short scroll away. */
@media (max-width: 991.98px) and (min-height: 740px) {
  .pvp-dock {
    position: sticky;
    bottom: calc(92px + env(safe-area-inset-bottom));
    z-index: 5;
    max-height: 60vh;
    overflow-y: auto;
    box-shadow: var(--pb-shadow-lg);
  }
}

/* ----- Lobby ----- */

.pvp-kinds {
  display: flex;
  align-self: flex-start;
  max-width: 100%;
  gap: 4px;
  padding: 4px;
  border-radius: 999px;
  border: 1px solid var(--pb-border-strong);
  background: var(--pb-input-bg);
}

.pvp-kinds button {
  min-width: 0;
  padding: 0.35rem 0.9rem;
  border: none;
  border-radius: 999px;
  background: none;
  color: var(--pb-text-muted);
  font-weight: 700;
  font-size: 0.85rem;
  white-space: nowrap;
}

.pvp-kinds button.active {
  background: var(--pb-text);
  color: var(--pb-bg);
}

.pvp-select {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  max-width: 28rem;
  font-weight: 700;
  font-size: 0.85rem;
}

.pvp-builder,
.pvp-deck,
.pvp-decks {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
}

.pvp-decks {
  gap: 1.25rem;
}

.pvp-deck + .pvp-deck {
  padding-top: 1.25rem;
  border-top: 1px solid var(--pb-border);
}

.pvp-deck-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.pvp-count {
  font-family: var(--pb-font-display);
  font-weight: 700;
  color: var(--pb-text-muted);
}

.pvp-count.full {
  color: var(--pb-success-text);
}

.pvp-deck-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.6rem;
  border-radius: var(--pb-radius-md);
  border: 1px solid var(--pb-border);
  background: var(--pb-bg-elevated);
}

.pvp-deck-lines {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 15rem), 1fr));
  gap: 0.3rem 0.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.pvp-deck-lines li {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
  font-size: 0.85rem;
}

.pvp-line-count {
  flex: none;
  font-family: var(--pb-font-display);
  font-weight: 700;
}

.pvp-line-name {
  min-width: 0;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pvp-line-stage {
  min-width: 0;
  font-size: 0.72rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pvp-line-button {
  flex: none;
  display: grid;
  place-items: center;
  width: 1.9rem;
  height: 1.9rem;
  border-radius: 50%;
  border: 1px solid var(--pb-border-strong);
  background: var(--pb-surface);
  color: var(--pb-text);
  font-weight: 800;
  line-height: 1;
}

.pvp-line-button:disabled {
  opacity: 0.4;
}

.pvp-line-button:focus-visible {
  outline: 2px solid var(--pb-focus);
  outline-offset: 2px;
}

.pvp-warn-text {
  color: var(--pb-danger-text);
}

.pvp-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.pvp-filters .form-control {
  flex: 1 1 12rem;
  min-width: 0;
}

.pvp-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.6rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

@media (min-width: 576px) {
  .pvp-grid {
    grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
  }
}

.pvp-grid > li {
  min-width: 0;
}

.pvp-pick {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  height: 100%;
  padding: 0.35rem;
  border-radius: var(--pb-radius-md);
  border: 2px solid var(--pb-border-strong);
  background: var(--pb-bg-elevated);
}

.pvp-pick.is-picked {
  border-color: var(--pb-accent);
}

/* A card the deck's energy can't pay: still allowed, dimmed */
.pvp-pick.is-off .pvp-pick-card {
  opacity: 0.55;
}

.pvp-abilities {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.pvp-abilities .pvp-note {
  margin: 0;
}

.pvp-off-note {
  font-size: 0.7rem;
  text-align: center;
}

.pvp-energy-pick {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: none;
}

.pvp-energy-pick legend {
  margin: 0;
  float: none;
  width: auto;
}

.pvp-energy-types {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.pvp-energy-types button {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.3rem 0.7rem;
  border-radius: 999px;
  border: 1px solid var(--pb-border-strong);
  background: var(--pb-input-bg);
  color: var(--pb-text-muted);
  font-weight: 700;
  font-size: 0.8rem;
}

.pvp-energy-types button.active {
  border-color: var(--pb-ring);
  background: var(--pb-selected);
  color: var(--pb-text);
}

.pvp-type-dot {
  width: 0.75rem;
  height: 0.75rem;
  border-radius: 50%;
  background: var(--dot);
  border: 1px solid var(--pb-border-strong);
}

.pvp-deck-energy {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem;
}

.pvp-zone-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.pvp-pick-card {
  flex: 1;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  text-align: left;
}

.pvp-pick-card:focus-visible {
  outline: 2px solid var(--pb-focus);
  outline-offset: 2px;
}

.pvp-pick-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
}

.pvp-pick-count {
  font-family: var(--pb-font-display);
  font-weight: 700;
  font-size: 0.85rem;
}

.pvp-builder-skeleton {
  height: 220px;
  border-radius: var(--pb-radius-md);
}

.pvp-warning {
  margin: 0;
  padding: 0.6rem 0.75rem;
  border-radius: var(--pb-radius-md);
  background: var(--pb-danger-bg);
  color: var(--pb-danger-text);
  font-weight: 600;
}

.pvp-start {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  text-align: center;
}

.pvp-bots {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding-top: 1.25rem;
  border-top: 1px solid var(--pb-border);
  text-align: center;
}

.pvp-bot-buttons {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
  width: 100%;
  max-width: 32rem;
}

.pvp-bot-button {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
  min-width: 0;
  padding: 0.6rem 0.5rem;
  border-radius: var(--pb-radius-md);
  border: 2px solid var(--pb-accent);
  background: var(--pb-bg-elevated);
  color: var(--pb-text);
  font-weight: 700;
}

.pvp-bot-button:disabled {
  border-color: var(--pb-border-strong);
  opacity: 0.5;
}

.pvp-bot-button:focus-visible {
  outline: 2px solid var(--pb-focus);
  outline-offset: 2px;
}

@media (hover: hover) {
  .pvp-bot-button:not(:disabled):hover {
    border-color: var(--pb-ring);
  }
}

.pvp-bot-reward {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--pb-text-muted);
  overflow-wrap: anywhere;
}

.pvp-coins-won {
  color: var(--pb-success-text);
  font-weight: 700;
}

.pvp-history,
.pvp-board {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.pvp-history li,
.pvp-board li {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  min-width: 0;
  padding: 0.45rem 0.6rem;
  border-radius: var(--pb-radius-md);
  background: var(--pb-bg-elevated);
}

.pvp-history-text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.pvp-history-text .pvp-muted {
  font-size: 0.75rem;
}

.pvp-result {
  flex: none;
  min-width: 4.5rem;
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 800;
  text-align: center;
  background: var(--pb-border);
}

.pvp-result.is-won {
  background: var(--pb-success-bg);
  color: var(--pb-success-text);
}

.pvp-result.is-lost {
  background: var(--pb-danger-bg);
  color: var(--pb-danger-text);
}

.pvp-change {
  flex: none;
  font-family: var(--pb-font-display);
}

.pvp-rank {
  flex: none;
  width: 1.75rem;
  font-family: var(--pb-font-display);
  font-weight: 700;
  color: var(--pb-text-muted);
}

.pvp-board-name {
  flex: 1;
  min-width: 0;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pvp-board .pvp-muted {
  font-size: 0.75rem;
  white-space: nowrap;
}

.pvp-board-skeleton {
  height: 160px;
  border-radius: var(--pb-radius-md);
}

.pvp-rules-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
}

.pvp-rules ul {
  margin: 0;
  padding-left: 1.1rem;
  color: var(--pb-text-muted);
}

.pvp-back {
  align-self: flex-start;
  font-weight: 700;
}

@media (prefers-reduced-motion: reduce) {
  .pvp-head {
    animation: none;
  }
}
</style>
