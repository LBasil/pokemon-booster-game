<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import * as sfx from '@/lib/sfx'
import { useChallengeStore } from '@/stores/challenge'
import { usePvpStore } from '@/stores/pvp'
import { useSettingsStore } from '@/stores/settings'
import { resetTimeLabel } from '@/utils/challenge'
import { BATTLES_PER_DAY, DECK_SIZE, MAX_ENERGY, MAX_ROUNDS, PRIZES_TO_WIN, RESISTANCE, canPay, damageLabel, parseFormat, record, toggleDeckCard } from '@/utils/pvp'
import AppHeader from '@/components/AppHeader.vue'
import PvpCard from '@/components/PvpCard.vue'

// PvP battles (challenge mode, migrations 0024 + 0025), asynchronous: I save a deck
// of 5 challenge cards per format (every card, one TCG era, one set), then
// attack: the server finds a player of close Elo with a deck in that format
// and plays it against mine, its cards hidden until they're played. Each
// round I pick a card, then one of its attacks I can pay for (energy: 1 at
// the start, +1 a round, 5 at most) or no attack to save energy; both cards
// hit each other. Knocked out cards give prizes (2 or 3 for ex, V, VMAX...),
// 3 win. Elo only, no coins. The format is remembered on this device
// (`pb-pvp-format`).
const FORMAT_KEY = 'pb-pvp-format'
const KINDS = ['all', 'era', 'set']

const { t, locale } = useI18n()
const pvp = usePvpStore()
const challenge = useChallengeStore()
const settings = useSettingsStore()
const resetTime = computed(() => resetTimeLabel(locale.value))

const format = ref(readFormat())
const building = ref(false)
const picks = ref([])
const eligibleLoading = ref(false)
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
  prizes: pvp.state?.prizes_to_win ?? PRIZES_TO_WIN,
  energy: pvp.state?.max_energy ?? MAX_ENERGY,
  rounds: pvp.state?.max_rounds ?? MAX_ROUNDS,
  battles: pvp.state?.battles_per_day ?? BATTLES_PER_DAY,
  resistance: pvp.state?.resistance ?? RESISTANCE,
}))

const errorFor = (err) => t(err?.code ? `challenge.errors.${err.code}` : 'challenge.errors.generic')

// ---------- Formats ----------

const kind = computed(() => parseFormat(format.value).kind)
const eras = computed(() => pvp.formats.eras ?? [])
const sets = computed(() => pvp.formats.sets ?? [])

function formatLabel(key) {
  const { kind: k, value } = parseFormat(key)
  if (k === 'all') return t('pvp.formats.all')
  if (k === 'era') return t('pvp.formats.era', { name: value })
  return sets.value.find((s) => s.set_id === value)?.name ?? value
}

/** My eligible cards in the selected format. */
const ownedHere = computed(() => {
  const { kind: k } = parseFormat(format.value)
  if (k === 'all') return pvp.formats.all ?? 0
  return [...eras.value, ...sets.value].find((f) => f.format === format.value)?.owned ?? 0
})

function pickKind(next) {
  if (next === kind.value) return
  building.value = false
  if (next === 'all') format.value = 'all'
  // The era / set where I have the most cards that can fight
  else {
    const list = next === 'era' ? eras.value : sets.value
    const best = [...list].sort((a, b) => b.owned - a.owned)[0]
    format.value = best?.format ?? (next === 'era' ? 'era:Base' : 'all')
  }
}

function pickFormat(event) {
  building.value = false
  format.value = event.target.value
}

// ---------- Deck ----------

const deck = computed(() => pvp.decks[format.value] ?? null)
const rating = computed(() => pvp.ratings[format.value] ?? null)
const myRecord = computed(() => record(rating.value))
const eligible = computed(() => pvp.eligible[format.value] ?? [])
const canFight = computed(() => deck.value?.valid && pvp.battlesLeft > 0 && !building.value)

async function editDeck() {
  building.value = true
  picks.value = deck.value?.valid ? deck.value.cards.map((card) => card.id) : []
  eligibleLoading.value = true
  errorMessage.value = ''
  try {
    await pvp.loadEligible(format.value, { force: true })
    // Cards that left the collection since can't stay picked
    const ids = new Set(eligible.value.map((card) => card.id))
    picks.value = picks.value.filter((id) => ids.has(id))
  } catch (err) {
    errorMessage.value = errorFor(err)
    building.value = false
  } finally {
    eligibleLoading.value = false
  }
}

function togglePick(id) {
  picks.value = toggleDeckCard(picks.value, id, rules.value.deck)
}

async function saveDeck() {
  if (busy.value || picks.value.length !== rules.value.deck) return
  busy.value = true
  errorMessage.value = ''
  try {
    await pvp.saveDeck(format.value, picks.value)
    building.value = false
  } catch (err) {
    errorMessage.value = errorFor(err)
  } finally {
    busy.value = false
  }
}

// ---------- Battle ----------

const battle = computed(() => finished.value ?? pvp.battle)
// The card picked in my hand, before choosing its attack
const selectedSlot = ref(null)
const selected = computed(() => {
  const card = battle.value?.mine[selectedSlot.value]
  return card && card.hp_left > 0 && !finished.value ? card : null
})
const unseen = computed(() => (battle.value ? Math.max(0, rules.value.deck - battle.value.theirs.seen.length) : 0))

function scrollToBattle() {
  nextTick(() => battleEl.value?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }))
}

async function fight() {
  if (busy.value || !canFight.value) return
  busy.value = true
  errorMessage.value = ''
  finished.value = null
  try {
    await pvp.start(format.value)
    scrollToBattle()
  } catch (err) {
    errorMessage.value = errorFor(err)
  } finally {
    busy.value = false
  }
}

function selectCard(slot) {
  selectedSlot.value = selectedSlot.value === slot ? null : slot
}

/** @param {number | null} attack - index in the selected card's attacks, null = no attack */
async function play(attack) {
  const slot = selected.value?.slot
  if (busy.value || finished.value || slot === undefined) return
  busy.value = true
  errorMessage.value = ''
  confirmForfeit.value = false
  try {
    const result = await pvp.play(slot, attack)
    // Keep the card picked for the next round while it stands
    if (result.round.ko_mine) selectedSlot.value = null
    if (result.battle.status === 'playing') {
      sfx.flip(settings.sound)
      if (result.round.ko_theirs) sfx.rare(settings.sound)
      if (result.round.ko_mine) sfx.buzz(settings.vibration)
    } else {
      finished.value = result.battle
      if (result.battle.status === 'won') sfx.hit(settings.sound)
      else sfx.buzz(settings.vibration)
    }
  } catch (err) {
    errorMessage.value = errorFor(err)
    // The battle is gone server side: back to the lobby
    if (err?.code === 'no_game') pvp.load()
  } finally {
    busy.value = false
  }
}

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

function backToLobby() {
  if (finished.value) format.value = finished.value.format
  finished.value = null
  selectedSlot.value = null
}

/** The last round, told from my side: cards and attacks by name. */
const lastRound = computed(() => {
  const round = battle.value?.log.at(-1)
  if (!round) return null
  const mine = battle.value.mine[round.a]
  const theirs = (battle.value.theirs.deck ?? battle.value.theirs.seen).find((card) => card.slot === round.d)
  return {
    ...round,
    mine: mine?.name ?? '',
    theirs: theirs?.name ?? '',
    myAttack: round.a_attack === null ? null : (mine?.attacks[round.a_attack]?.name ?? ''),
    theirAttack: round.d_attack === null ? null : (theirs?.attacks[round.d_attack]?.name ?? ''),
  }
})

const opponentName = computed(() => battle.value?.opponent.username ?? t('pvp.privateTrainer'))

const resultTitle = computed(() => (finished.value ? t(`pvp.result.${finished.value.status}`) : ''))

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
  if (pvp.loaded && !pvp.unavailable) loadBoard()
})

onMounted(async () => {
  challenge.load() // the header's coins
  await pvp.load()
  if (!pvp.loaded || pvp.unavailable) return
  if (pvp.battle) format.value = pvp.battle.format
  // A remembered format that no longer exists (set renamed, new device)
  else if (!['all', ...eras.value.map((e) => e.format), ...sets.value.map((s) => s.format)].includes(format.value)) format.value = 'all'
  loadBoard()
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
              <dt>{{ t('pvp.myPrizes') }}</dt>
              <dd>{{ battle.my_prizes }} / {{ rules.prizes }}</dd>
            </div>
            <div>
              <dt>{{ t('pvp.round') }}</dt>
              <dd>{{ battle.round }} / {{ rules.rounds }}</dd>
            </div>
            <div>
              <dt>{{ t('pvp.theirPrizes') }}</dt>
              <dd>{{ battle.their_prizes }} / {{ rules.prizes }}</dd>
            </div>
          </dl>

          <div class="pvp-energies">
            <span class="pvp-energy" role="meter" :aria-label="t('pvp.myEnergy')" aria-valuemin="0" :aria-valuemax="rules.energy" :aria-valuenow="battle.my_energy">
              <span class="pvp-energy-label">{{ t('pvp.myEnergy') }}</span>
              <span class="pvp-pips" aria-hidden="true"><span v-for="n in rules.energy" :key="n" :class="{ on: n <= battle.my_energy }"></span></span>
              <strong>{{ battle.my_energy }}</strong>
            </span>
            <span class="pvp-energy" role="meter" :aria-label="t('pvp.theirEnergy')" aria-valuemin="0" :aria-valuemax="rules.energy" :aria-valuenow="battle.their_energy">
              <span class="pvp-energy-label">{{ t('pvp.theirEnergy') }}</span>
              <span class="pvp-pips" aria-hidden="true"><span v-for="n in rules.energy" :key="n" :class="{ on: n <= battle.their_energy }"></span></span>
              <strong>{{ battle.their_energy }}</strong>
            </span>
          </div>

          <h3 class="pvp-side-title">{{ t('pvp.theirCards', { name: opponentName }) }}</h3>
          <ul class="pvp-row pvp-theirs" :aria-label="t('pvp.theirCards', { name: opponentName })">
            <li v-for="card in battle.theirs.deck ?? battle.theirs.seen" :key="card.slot" :class="{ 'is-last': lastRound?.d === card.slot }">
              <PvpCard :card="card" show-hp />
            </li>
            <template v-if="!battle.theirs.deck">
              <li v-for="n in unseen" :key="`hidden-${n}`"><PvpCard hidden /></li>
            </template>
          </ul>

          <p class="pvp-feedback" role="status" aria-live="polite">
            <template v-if="finished">
              <strong :class="finished.status === 'won' ? 'pvp-good' : finished.status === 'draw' ? '' : 'pvp-bad'">{{ resultTitle }}</strong>
              <span>{{ t('pvp.eloChange', { change: signed(finished.elo_change) }) }}</span>
            </template>
            <template v-else-if="lastRound">
              <span v-if="lastRound.myAttack === null">{{ t('pvp.roundSaved', { mine: lastRound.mine }) }}</span>
              <span v-else>
                {{ t('pvp.roundDealt', { mine: lastRound.mine, attack: lastRound.myAttack, theirs: lastRound.theirs, damage: lastRound.dealt }) }}
                <template v-if="lastRound.roll_a">{{ t('pvp.roll', { roll: lastRound.roll_a }) }}</template>
              </span>
              <span v-if="lastRound.theirAttack === null">{{ t('pvp.roundTheySaved', { theirs: lastRound.theirs }) }}</span>
              <span v-else>
                {{ t('pvp.roundTaken', { theirs: lastRound.theirs, attack: lastRound.theirAttack, damage: lastRound.taken }) }}
                <template v-if="lastRound.roll_d">{{ t('pvp.roll', { roll: lastRound.roll_d }) }}</template>
              </span>
              <strong v-if="lastRound.ko_theirs" class="pvp-good">{{ t('pvp.koTheirs', { name: lastRound.theirs }) }}</strong>
              <strong v-if="lastRound.ko_mine" class="pvp-bad">{{ t('pvp.koMine', { name: lastRound.mine }) }}</strong>
            </template>
            <template v-else>{{ t('pvp.firstRound') }}</template>
          </p>

          <h3 class="pvp-side-title">{{ finished ? t('pvp.myCards') : t('pvp.playOne') }}</h3>
          <ul class="pvp-row pvp-mine" :aria-label="t('pvp.myCards')">
            <li v-for="card in battle.mine" :key="card.slot">
              <button
                type="button"
                class="pvp-play"
                :class="{ 'is-last': lastRound?.a === card.slot, 'is-selected': selected?.slot === card.slot }"
                :aria-pressed="selected?.slot === card.slot"
                :disabled="busy || !!finished || card.hp_left === 0"
                :aria-label="t('pvp.playCard', { name: card.name, left: card.hp_left, hp: card.hp })"
                @click="selectCard(card.slot)"
              >
                <PvpCard :card="card" show-hp />
              </button>
            </li>
          </ul>

          <!-- The picked card's attacks: the ones I can't pay for yet stay greyed -->
          <div v-if="selected" class="pvp-attack-panel" role="group" :aria-label="t('pvp.attackWith', { name: selected.name })">
            <p class="pvp-side-title">{{ t('pvp.attackWith', { name: selected.name }) }}</p>
            <div class="pvp-attack-buttons">
              <button
                v-for="(attack, i) in selected.attacks"
                :key="i"
                type="button"
                class="pvp-attack-button"
                :disabled="busy || !canPay(attack, battle.my_energy)"
                @click="play(i)"
              >
                <span class="pvp-attack-cost">{{ t('pvp.cost', { count: attack.cost }, attack.cost) }}</span>
                <span class="pvp-attack-title">{{ attack.name }}</span>
                <strong>{{ damageLabel(attack) }}</strong>
              </button>
              <button type="button" class="pvp-attack-button is-skip" :disabled="busy" @click="play(null)">
                <span class="pvp-attack-title">{{ t('pvp.noAttack') }}</span>
              </button>
            </div>
          </div>
          <p v-else-if="!finished" class="pvp-note pvp-hint">{{ t('pvp.pickCard') }}</p>

          <div class="pvp-actions">
            <button v-if="finished" type="button" class="btn btn-primary glow-button" @click="backToLobby">{{ t('pvp.back') }}</button>
            <button v-else type="button" class="btn btn-sm" :class="confirmForfeit ? 'btn-danger' : 'btn-outline-secondary'" :disabled="busy" @click="forfeit">
              {{ confirmForfeit ? t('pvp.forfeitConfirm') : t('pvp.forfeit') }}
            </button>
          </div>
        </section>

        <!-- ============ Lobby: format, deck, fight ============ -->
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
                {{ t('pvp.optionCount', { name: set.name, count: set.owned }, set.owned) }}
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
              <h3 class="pvp-side-title">{{ t('pvp.buildTitle', { format: formatLabel(format) }) }}</h3>
              <span class="pvp-count" :class="{ full: picks.length === rules.deck }">{{ picks.length }} / {{ rules.deck }}</span>
            </div>
            <div v-if="eligibleLoading" class="pb-skeleton pvp-builder-skeleton" aria-busy="true"></div>
            <p v-else-if="eligible.length < rules.deck" class="pvp-note">
              {{ t('pvp.notEnough', { count: eligible.length, deck: rules.deck }, eligible.length) }}
              <RouterLink :to="{ name: 'challenge-boosters' }">{{ t('pvp.openBoosters') }}</RouterLink>
            </p>
            <ul v-if="!eligibleLoading && eligible.length" class="pvp-grid">
              <li v-for="card in eligible" :key="card.id">
                <button
                  type="button"
                  class="pvp-pick"
                  :class="{ 'is-picked': picks.includes(card.id) }"
                  :aria-pressed="picks.includes(card.id)"
                  :disabled="!picks.includes(card.id) && picks.length >= rules.deck"
                  @click="togglePick(card.id)"
                >
                  <PvpCard :card="card" />
                  <span v-if="picks.includes(card.id)" class="pvp-pick-badge" aria-hidden="true">{{ picks.indexOf(card.id) + 1 }}</span>
                </button>
              </li>
            </ul>
            <div class="pvp-actions">
              <button type="button" class="btn btn-primary" :disabled="busy || picks.length !== rules.deck" @click="saveDeck">{{ t('pvp.saveDeck') }}</button>
              <button type="button" class="btn btn-outline-secondary" :disabled="busy" @click="building = false">{{ t('pvp.cancel') }}</button>
            </div>
          </div>

          <!-- Saved deck -->
          <div v-else class="pvp-deck">
            <div class="pvp-builder-head">
              <h3 class="pvp-side-title">{{ t('pvp.deckTitle') }}</h3>
              <button type="button" class="btn btn-outline-secondary btn-sm" @click="editDeck">
                {{ deck ? t('pvp.editDeck') : t('pvp.buildDeck') }}
              </button>
            </div>
            <template v-if="deck">
              <p v-if="!deck.valid" class="pvp-warning" role="alert">{{ t('pvp.deckInvalid') }}</p>
              <ul class="pvp-row">
                <li v-for="(card, i) in deck.cards" :key="i"><PvpCard :card="card" /></li>
              </ul>
              <p class="pvp-note">{{ t('pvp.deckDefends') }}</p>
            </template>
            <p v-else class="pvp-note">{{ t('pvp.noDeck', { count: ownedHere, deck: rules.deck }, ownedHere) }}</p>
          </div>

          <div class="pvp-start">
            <button type="button" class="btn btn-primary btn-lg glow-button" :disabled="busy || !canFight" @click="fight">{{ t('pvp.fight') }}</button>
            <p class="pvp-note">
              {{ pvp.battlesLeft ? t('pvp.battlesLeftLine', { count: pvp.battlesLeft }, pvp.battlesLeft) : t('pvp.noBattlesLeft') }}
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
                {{ t(`pvp.history.${entry.role}`, { name: entry.opponent ?? t('pvp.privateTrainer') }) }}
                <span class="pvp-muted">{{ formatLabel(entry.format) }}</span>
              </span>
              <strong class="pvp-change">{{ signed(entry.elo_change) }}</strong>
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
            <li>{{ t('pvp.rules.deck', { deck: rules.deck }) }}</li>
            <li>{{ t('pvp.rules.hidden') }}</li>
            <li>{{ t('pvp.rules.round', { rounds: rules.rounds }) }}</li>
            <li>{{ t('pvp.rules.energy', { max: rules.energy }) }}</li>
            <li>{{ t('pvp.rules.prizes', { prizes: rules.prizes }) }}</li>
            <li>{{ t('pvp.rules.damage', { resistance: rules.resistance }) }}</li>
            <li>{{ t('pvp.rules.elo') }}</li>
            <li>{{ t('pvp.rules.limit', { count: rules.battles, time: resetTime }) }}</li>
          </ul>
        </section>
      </template>

      <RouterLink :to="{ name: 'challenge-games' }" class="pvp-back"><span aria-hidden="true">←</span> {{ t('games.back') }}</RouterLink>
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
  box-shadow: var(--pb-shadow-card);
}

.pvp-battle-head,
.pvp-builder-head {
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

.pvp-format-chip {
  padding: 0.15rem 0.6rem;
  border-radius: 999px;
  border: 1px solid var(--pb-border-strong);
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--pb-text-muted);
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
  padding: 0.6rem 0.75rem;
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
  font-size: 1.05rem;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.pvp-side-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
}

/* 5 cards: one row from tablets, 3 + 2 on phones */
.pvp-row,
.pvp-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

@media (min-width: 768px) {
  /* Capped: full-width cards on a PC were ~300px tall each */
  .pvp-row {
    grid-template-columns: repeat(5, minmax(0, 1fr));
    width: 100%;
    max-width: 46rem;
    margin-inline: auto;
  }

  .pvp-grid {
    grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
  }
}

.pvp-row > li,
.pvp-grid > li {
  min-width: 0;
}

.pvp-theirs > li {
  padding: 0.35rem;
  border-radius: var(--pb-radius-md);
  border: 2px solid transparent;
}

.pvp-theirs > li.is-last {
  border-color: var(--pb-danger-text);
}

.pvp-play,
.pvp-pick {
  position: relative;
  width: 100%;
  height: 100%;
  padding: 0.35rem;
  border-radius: var(--pb-radius-md);
  border: 2px solid var(--pb-border-strong);
  background: var(--pb-bg-elevated);
  color: var(--pb-text);
  cursor: pointer;
  transition:
    transform 0.2s var(--pb-ease-out),
    border-color 0.2s;
}

.pvp-play:disabled,
.pvp-pick:disabled {
  cursor: default;
}

.pvp-pick:disabled:not(.is-picked) {
  opacity: 0.5;
}

@media (hover: hover) {
  .pvp-play:not(:disabled):hover,
  .pvp-pick:not(:disabled):hover {
    transform: translateY(-2px);
    border-color: var(--pb-ring);
  }
}

.pvp-play:focus-visible,
.pvp-pick:focus-visible {
  outline: 2px solid var(--pb-focus);
  outline-offset: 2px;
}

.pvp-play.is-last {
  border-color: var(--pb-ring);
}

.pvp-play.is-selected {
  border-color: var(--pb-accent);
  box-shadow: 0 0 0 2px var(--pb-accent);
}

.pvp-energies {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 0.5rem 1rem;
}

.pvp-energy {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
  font-weight: 700;
}

.pvp-energy-label {
  color: var(--pb-text-muted);
}

.pvp-pips {
  display: flex;
  gap: 3px;
}

.pvp-pips span {
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 50%;
  border: 1px solid var(--pb-border-strong);
  background: var(--pb-input-bg);
}

.pvp-pips span.on {
  border-color: var(--pb-coin);
  background: var(--pb-coin);
}

.pvp-attack-panel {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
  border-radius: var(--pb-radius-md);
  border: 1px solid var(--pb-border-strong);
  background: var(--pb-bg-elevated);
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
  opacity: 0.5;
}

.pvp-attack-button.is-skip {
  border-style: dashed;
  border-color: var(--pb-border-strong);
  color: var(--pb-text-muted);
}

.pvp-attack-button:focus-visible {
  outline: 2px solid var(--pb-focus);
  outline-offset: 2px;
}

@media (hover: hover) {
  .pvp-attack-button:not(:disabled):hover {
    background: var(--pb-bg-elevated);
  }
}

.pvp-attack-cost {
  flex: none;
  padding: 0.05rem 0.4rem;
  border-radius: 999px;
  background: var(--pb-input-bg);
  font-size: 0.7rem;
  color: var(--pb-text-muted);
}

.pvp-attack-title {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.pvp-hint {
  text-align: center;
}

.pvp-pick.is-picked {
  border-color: var(--pb-accent);
}

.pvp-pick-badge {
  position: absolute;
  top: -0.55rem;
  left: -0.55rem;
  display: grid;
  place-items: center;
  width: 1.6rem;
  height: 1.6rem;
  border-radius: 50%;
  background: var(--pb-accent);
  color: var(--pb-accent-ink);
  font-family: var(--pb-font-display);
  font-size: 0.8rem;
  font-weight: 800;
}

.pvp-feedback {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.25rem 0.75rem;
  min-height: 1.75rem;
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
.pvp-deck {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
}

.pvp-count {
  font-family: var(--pb-font-display);
  font-weight: 700;
  color: var(--pb-text-muted);
}

.pvp-count.full {
  color: var(--pb-success-text);
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
