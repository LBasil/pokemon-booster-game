<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCardLocale } from '@/composables/useCardLocale'
import { useChallengeStore } from '@/stores/challenge'
import { usePvpStore } from '@/stores/pvp'
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
  autoDeck,
  autoEnergy,
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
import PvpBattle from '@/components/PvpBattle.vue'
import PvpCardSheet from '@/components/PvpCardSheet.vue'

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
const { french, cardName, cardImage, fallback } = useCardLocale()
const pvp = usePvpStore()
const challenge = useChallengeStore()
const resetTime = computed(() => resetTimeLabel(locale.value))

const format = ref(readFormat())
const busy = ref(false)
const errorMessage = ref('')

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
// User, 2026-10-06: after "Auto deck" every eligible card showed under the
// deck ("infâme"): the pool and the energy picker fold away once the deck
// is made, a tap opens them
const showPool = ref(true)
const showEnergy = ref(true)
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
  showPool.value = !deckCheck(picks.value, eligibleById.value, rules.value.deck, energy.value).ready
  showEnergy.value = !energy.value.length
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
  showEnergy.value = true
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
  // a full saved deck opens on its cards; a new one on the pool to pick from
  showPool.value = !deckCheck(kept, eligibleById.value, rules.value.deck, energy.value).ready
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
// The battle itself lives in PvpBattle (a full-screen mat on phones, user
// 2026-10-07); the view keeps the one just over on screen until "Back".

const battle = computed(() => pvp.finished ?? pvp.battle)
const botName = (level) => t('pvp.botName', { level: t(`pvp.levels.${level}`) })
const sheet = ref(null) // a deck card read in full

function openSheet(card) {
  sheet.value = card ? { card } : null
}

function backToLobby() {
  if (pvp.finished) format.value = pvp.finished.format
  pvp.finished = null
  loadEligible()
}

function scrollToBattle() {
  nextTick(() => document.querySelector('.pvp-battle')?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }))
}

/** @param {string | null} [level] - a bot level, null = a player */
async function fight(level = null) {
  if (busy.value || !(level ? canFightBot.value : canFight.value)) return
  busy.value = true
  errorMessage.value = ''
  pvp.finished = null
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

const signed = (n) => (n > 0 ? `+${n}` : String(n ?? 0))

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
        <PvpBattle
          v-if="battle"
          :key="battle.id"
          :battle="battle"
          :finished="!!pvp.finished"
          :format-name="formatLabel(battle.format)"
          :rules="rules"
          @back="backToLobby"
        />

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

            <p v-if="!showEnergy" class="pvp-energy-summary">
              <span>{{ t('pvp.energyShort') }} <EnergyIcons :types="energy" /> {{ typeList(energy) }}</span>
              <button type="button" class="btn btn-outline-secondary btn-sm" @click="showEnergy = true">{{ t('pvp.change') }}</button>
            </p>
            <fieldset v-else class="pvp-energy-pick">
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
              <!-- Like Pocket's deck view: the cards themselves, 2× on top -->
              <ul v-else class="pvp-deck-cards">
                <li v-for="entry in pickedGroups" :key="entry.id">
                  <button type="button" class="pvp-thumb" :aria-label="`${cardName(entry.card)}, ${t('pvp.details')}`" @click="openSheet(entry.card)">
                    <img :src="cardImage(entry.card)" :data-fallback="fallback(entry.card)" alt="" width="245" height="342" loading="lazy" />
                    <span class="pvp-thumb-count">{{ entry.count }}×</span>
                  </button>
                  <span class="pvp-thumb-name">{{ cardName(entry.card) }}</span>
                  <button type="button" class="pvp-line-button pvp-thumb-remove" :aria-label="t('pvp.remove', { name: cardName(entry.card) })" @click="removePick(entry.id)">
                    −
                  </button>
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

            <button
              v-if="!eligibleLoading && ownedHere >= rules.deck"
              type="button"
              class="btn btn-outline-secondary pvp-pool-toggle"
              :aria-expanded="showPool"
              @click="showPool = !showPool"
            >
              {{ showPool ? t('pvp.hidePool') : t('pvp.showPool', { count: eligible.length }, eligible.length) }}
            </button>
            <div v-if="showPool" class="pvp-filters">
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
            <ul v-if="showPool && !eligibleLoading && shown.length" class="pvp-grid">
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
      <PvpCardSheet :card="sheet?.card ?? null" @close="sheet = null" />
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

.pvp-builder-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.pvp-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
  margin: 0;
}

.pvp-stats > div {
  min-width: 0;
  padding: 0.5rem 0.6rem;
  border-radius: var(--pb-radius-md);
  border: 1px solid var(--pb-border);
  background: var(--pb-bg-elevated);
}

.pvp-stats dt {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--pb-text-muted);
}

.pvp-stats dd {
  margin: 0.2rem 0 0;
  font-family: var(--pb-font-display);
  font-size: 1rem;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.pvp-side-title {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.pvp-attack-title {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.pvp-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.5rem;
}

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

.pvp-deck-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(4rem, 1fr));
  gap: 0.6rem 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.pvp-deck-cards > li {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}

.pvp-thumb {
  position: relative;
  display: block;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: none;
}

.pvp-thumb img {
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 245 / 342;
  object-fit: cover;
  border-radius: 6px;
}

.pvp-thumb:focus-visible {
  outline: 2px solid var(--pb-focus);
  outline-offset: 2px;
}

.pvp-thumb-count {
  position: absolute;
  left: 0.25rem;
  bottom: 0.25rem;
  padding: 0.05rem 0.4rem;
  border-radius: 999px;
  border: 1px solid var(--pb-border-strong);
  background: var(--pb-bg);
  color: var(--pb-text);
  font-family: var(--pb-font-display);
  font-size: 0.75rem;
  font-weight: 700;
}

.pvp-thumb-name {
  min-width: 0;
  font-size: 0.72rem;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pvp-thumb-remove {
  position: absolute;
  top: -0.4rem;
  right: -0.4rem;
  width: 1.6rem;
  height: 1.6rem;
}

.pvp-energy-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin: 0;
  font-weight: 700;
}

.pvp-energy-summary > span {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem;
}

.pvp-pool-toggle {
  align-self: flex-start;
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
