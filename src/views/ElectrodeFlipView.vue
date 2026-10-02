<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { resetTimeLabel } from '@/utils/challenge'
import * as sfx from '@/lib/sfx'
import { useChallengeStore } from '@/stores/challenge'
import { useElectrodeFlipStore } from '@/stores/electrodeFlip'
import { useSettingsStore } from '@/stores/settings'
import { DAILY_COINS, LEVELS, SIZE, lineKind, tileIndex } from '@/utils/electrodeFlip'
import AppHeader from '@/components/AppHeader.vue'
import CoinAmount from '@/components/CoinAmount.vue'

// "Shiny Electrode Flip" (challenge mode, migration 0014): Voltorb Flip.
// The server deals the board and only ever sends the hints and the tiles
// already flipped (all of them once the board is over). The board on screen
// (`view`) is the last one the server sent, so it stays revealed after the
// end while the store already has no board in progress.
const LINES = [0, 1, 2, 3, 4]
const MARKS = ['e', '1', '2', '3']

const { t, locale } = useI18n()
// The daily reset (00:00 UTC) in the player's own time
const resetTime = computed(() => resetTimeLabel(locale.value))
const game = useElectrodeFlipStore()
const challenge = useChallengeStore()
const settings = useSettingsStore()

const view = ref(null) // electrode_flip_view() of the board on screen
const over = ref(null) // { status, earned, points, nextLevel, record, capped }
const busy = ref(false)
const errorMessage = ref('')
const lastFlipped = ref(-1)
const bestBefore = ref(0)
const boardEl = ref(null)

// Memo marks: the player's own notes on hidden tiles, never sent anywhere
const memoOn = ref(false)
const memoMark = ref('e')
const marks = ref([])
const clearMarks = () => (marks.value = Array.from({ length: SIZE * SIZE }, () => []))
clearMarks()

function toggleMark(index, mark) {
  const list = marks.value[index]
  marks.value[index] = list.includes(mark) ? list.filter((m) => m !== mark) : [...list, mark].sort()
}

// ---------- Flow ----------

const errorFor = (err) => t(err?.code ? `challenge.errors.${err.code}` : 'challenge.errors.generic')

function showBoard(board) {
  view.value = board
  over.value = null
  lastFlipped.value = -1
}

async function start() {
  if (busy.value) return
  busy.value = true
  errorMessage.value = ''
  bestBefore.value = game.bestPoints
  try {
    await game.start()
    clearMarks()
    memoOn.value = false
    showBoard(game.board)
    nextTick(() => boardEl.value?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }))
  } catch (err) {
    errorMessage.value = errorFor(err)
  } finally {
    busy.value = false
  }
}

function ended(result) {
  const board = result.result
  if (board.status === 'playing') return
  over.value = {
    status: board.status,
    earned: result.earned,
    points: board.points,
    nextLevel: result.state.level,
    record: board.status !== 'lost' && board.points > bestBefore.value,
    capped: board.status !== 'lost' && result.earned < board.points,
  }
  if (board.status === 'won') sfx.rare(settings.sound)
}

async function flipTile(index) {
  if (busy.value || over.value || !view.value || view.value.tiles[index] !== null) return
  if (memoOn.value) {
    toggleMark(index, memoMark.value)
    return
  }
  busy.value = true
  errorMessage.value = ''
  try {
    const result = await game.flip(index)
    lastFlipped.value = index
    view.value = result.result
    if (result.value === 0) sfx.buzz(settings.vibration, [60, 40, 120])
    else sfx.flip(settings.sound)
    ended(result)
  } catch (err) {
    errorMessage.value = errorFor(err)
    if (err?.code === 'no_game') {
      view.value = null
      game.load()
    }
  } finally {
    busy.value = false
  }
}

// Right click: mark an Electrode without switching to memo mode
function markElectrode(index, event) {
  if (over.value || !view.value || view.value.tiles[index] !== null) return
  event.preventDefault()
  toggleMark(index, 'e')
}

async function cashOut() {
  if (busy.value || over.value || !view.value?.flips) return
  busy.value = true
  errorMessage.value = ''
  try {
    const result = await game.cashOut()
    lastFlipped.value = -1
    view.value = result.result
    ended(result)
  } catch (err) {
    errorMessage.value = errorFor(err)
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  challenge.load() // the header's coins
  await game.load()
  bestBefore.value = game.bestPoints
  if (game.board) showBoard(game.board) // resumed after a reload
})

// ---------- Display ----------

const level = computed(() => view.value?.level ?? game.level)
const playing = computed(() => view.value?.status === 'playing')
const paying = computed(() => game.coinsLeft > 0)
const rules = computed(() => ({ levels: game.state?.levels ?? LEVELS, max: game.state?.daily_coins ?? DAILY_COINS }))

function tileLabel(row, col) {
  const index = tileIndex(row, col)
  const value = view.value.tiles[index]
  const where = { row: row + 1, col: col + 1 }
  if (value === null) {
    const noted = marks.value[index].map((m) => (m === 'e' ? t('electrodeFlip.markElectrode') : m)).join(', ')
    return noted ? t('electrodeFlip.tileMarked', { ...where, marks: noted }) : t('electrodeFlip.tileHidden', where)
  }
  return value === 0 ? t('electrodeFlip.tileElectrode', where) : t('electrodeFlip.tileValue', { ...where, value })
}

function tileClass(index) {
  const value = view.value.tiles[index]
  return {
    'is-up': value !== null,
    'is-electrode': value === 0,
    'is-bonus': value >= 2,
    // Revealed at the end without being flipped
    'is-missed': value !== null && !view.value.flipped[index],
    'just-flipped': index === lastFlipped.value,
  }
}

const hintLabel = (kind, n, hint) => t(`electrodeFlip.${kind}Hint`, { n: n + 1, points: hint.points, electrodes: hint.electrodes })

const nextLevelLine = computed(() => {
  if (!over.value) return ''
  const next = over.value.nextLevel
  if (next > level.value) return t('electrodeFlip.nextUp', { level: next })
  if (next < level.value) return t('electrodeFlip.nextDown', { level: next })
  return t('electrodeFlip.nextSame', { level: next })
})
</script>

<template>
  <div class="pb-page">
    <AppHeader />

    <main class="container ef">
      <header class="ef-head">
        <h1 class="ef-title">{{ t('electrodeFlip.title') }}</h1>
        <p class="ef-subtitle">{{ t('electrodeFlip.subtitle') }}</p>
      </header>

      <p v-if="game.unavailable" class="ef-note">{{ t('electrodeFlip.unavailable') }}</p>
      <div v-else-if="game.error" class="alert alert-danger" role="alert">{{ t('electrodeFlip.loadError') }}</div>
      <div v-else-if="!game.loaded" class="pb-skeleton ef-skeleton" aria-busy="true"></div>

      <template v-else>
        <div v-if="errorMessage" class="alert alert-danger" role="alert">{{ errorMessage }}</div>

        <!-- ============ The board ============ -->
        <section v-if="view" ref="boardEl" class="ef-game" aria-labelledby="ef-board-title">
          <div class="ef-run">
            <h2 id="ef-board-title" class="ef-level">{{ t('electrodeFlip.level', { level }) }}</h2>
            <span class="ef-points">
              {{ t('electrodeFlip.points') }} <strong>{{ view.points }}</strong>
            </span>
            <span class="ef-chip" :class="{ paid: paying }">{{ paying ? t('electrodeFlip.paidChip') : t('electrodeFlip.freeChip') }}</span>
          </div>

          <div class="ef-board" :class="{ memo: memoOn && playing, done: !playing }">
            <template v-for="row in LINES" :key="`r${row}`">
              <button
                v-for="col in LINES"
                :key="tileIndex(row, col)"
                type="button"
                class="ef-tile"
                :class="tileClass(tileIndex(row, col))"
                :data-index="tileIndex(row, col)"
                :aria-label="tileLabel(row, col)"
                :disabled="busy || !playing || view.tiles[tileIndex(row, col)] !== null"
                @click="flipTile(tileIndex(row, col))"
                @contextmenu="markElectrode(tileIndex(row, col), $event)"
              >
                <span v-if="view.tiles[tileIndex(row, col)] === null" class="ef-back">
                  <span v-if="marks[tileIndex(row, col)].length" class="ef-marks" aria-hidden="true">
                    <span v-for="mark in marks[tileIndex(row, col)]" :key="mark" :class="`m-${mark}`">
                      <span v-if="mark === 'e'" class="ef-electrode tiny"></span>
                      <template v-else>{{ mark }}</template>
                    </span>
                  </span>
                </span>
                <span v-else class="ef-face" aria-hidden="true">
                  <span v-if="view.tiles[tileIndex(row, col)] === 0" class="ef-electrode"><i></i><i></i></span>
                  <span v-else class="ef-value">{{ view.tiles[tileIndex(row, col)] }}</span>
                </span>
              </button>
              <span
                class="ef-hint"
                :class="`is-${lineKind(view.rows[row])}`"
                role="img"
                :aria-label="hintLabel('row', row, view.rows[row])"
                :data-row="row"
              >
                <strong>{{ view.rows[row].points }}</strong>
                <span class="ef-hint-e"><span class="ef-electrode tiny"></span>{{ view.rows[row].electrodes }}</span>
              </span>
            </template>
            <span
              v-for="col in LINES"
              :key="`c${col}`"
              class="ef-hint"
              :class="`is-${lineKind(view.cols[col])}`"
              role="img"
              :aria-label="hintLabel('col', col, view.cols[col])"
              :data-col="col"
            >
              <strong>{{ view.cols[col].points }}</strong>
              <span class="ef-hint-e"><span class="ef-electrode tiny"></span>{{ view.cols[col].electrodes }}</span>
            </span>
            <span class="ef-corner" aria-hidden="true"><span class="ef-electrode"><i></i><i></i></span></span>
          </div>

          <!-- Memo + cash out -->
          <div v-if="playing" class="ef-tools">
            <button type="button" class="btn btn-outline-secondary btn-sm ef-memo" :aria-pressed="memoOn" @click="memoOn = !memoOn">
              {{ t('electrodeFlip.memo') }}
            </button>
            <div v-if="memoOn" class="ef-memo-marks" role="group" :aria-label="t('electrodeFlip.memoPick')">
              <button
                v-for="mark in MARKS"
                :key="mark"
                type="button"
                class="ef-memo-mark"
                :aria-pressed="memoMark === mark"
                :aria-label="mark === 'e' ? t('electrodeFlip.markElectrode') : t('electrodeFlip.mark', { value: mark })"
                @click="memoMark = mark"
              >
                <span v-if="mark === 'e'" class="ef-electrode tiny"><i></i><i></i></span>
                <template v-else>{{ mark }}</template>
              </button>
            </div>
            <button type="button" class="btn btn-primary btn-sm ef-cash" :disabled="busy || !view.flips" @click="cashOut">
              {{ t('electrodeFlip.cashOut', { points: view.points }) }}
            </button>
          </div>

          <p v-if="playing" class="ef-feedback" role="status" aria-live="polite">
            {{ memoOn ? t('electrodeFlip.memoOn') : t('electrodeFlip.howTo') }}
          </p>
        </section>

        <!-- ============ End of a board ============ -->
        <section v-if="over" class="ef-over" :class="`is-${over.status}`" aria-labelledby="ef-over-title">
          <h2 id="ef-over-title" class="ef-over-title">{{ t(`electrodeFlip.over.${over.status}`) }}</h2>
          <p v-if="over.status !== 'lost'" class="ef-over-line">
            {{ t('electrodeFlip.overPoints', { points: over.points }) }}
          </p>
          <p v-if="over.record" class="ef-record"><span class="pb-holo-text">{{ t('electrodeFlip.record') }}</span></p>
          <p v-if="over.earned" class="ef-over-line">{{ t('electrodeFlip.overCoins') }} <CoinAmount :amount="over.earned" signed /></p>
          <p v-else-if="over.capped" class="ef-over-line ef-muted">{{ t('electrodeFlip.capped') }}</p>
          <p class="ef-over-line ef-muted">{{ nextLevelLine }}</p>
        </section>

        <!-- ============ Start ============ -->
        <section v-if="!playing" class="ef-start">
          <button type="button" class="btn btn-primary btn-lg glow-button" :disabled="busy" @click="start">
            {{ over ? t('electrodeFlip.next', { level: game.level }) : t('electrodeFlip.deal', { level: game.level }) }}
          </button>
          <p class="ef-muted">
            {{ paying ? t('electrodeFlip.coinsLeftLine', { count: game.coinsLeft }) : t('electrodeFlip.nextFree') }}
          </p>
        </section>

        <dl class="ef-stats">
          <div>
            <dt>{{ t('electrodeFlip.statLevel') }}</dt>
            <dd>{{ game.level }} / {{ rules.levels }}</dd>
          </div>
          <div>
            <dt>{{ t('electrodeFlip.statToday') }}</dt>
            <dd><CoinAmount :amount="game.state.today_coins" /> <span class="ef-of">/ {{ rules.max }}</span></dd>
          </div>
          <div>
            <dt>{{ t('electrodeFlip.statBest') }}</dt>
            <dd>{{ game.bestPoints }}</dd>
          </div>
        </dl>

        <!-- ============ Rules ============ -->
        <section class="ef-rules" aria-labelledby="ef-rules-title">
          <h2 id="ef-rules-title" class="ef-rules-title">{{ t('electrodeFlip.rulesTitle') }}</h2>
          <ul>
            <li>{{ t('electrodeFlip.rules.tiles') }}</li>
            <li>{{ t('electrodeFlip.rules.points', { levels: rules.levels }) }}</li>
            <li>{{ t('electrodeFlip.rules.electrode') }}</li>
            <li>{{ t('electrodeFlip.rules.level') }}</li>
            <li>{{ t('electrodeFlip.rules.coins', { max: rules.max, time: resetTime }) }}</li>
            <li>{{ t('electrodeFlip.rules.memo') }}</li>
          </ul>
        </section>
      </template>

      <RouterLink :to="{ name: 'challenge-games' }" class="ef-back-link"><span aria-hidden="true">←</span> {{ t('games.back') }}</RouterLink>
    </main>
  </div>
</template>

<style scoped>
.ef {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding-top: 1rem;
}

.ef-head {
  animation: pb-rise 0.6s var(--pb-ease-out) both;
}

.ef-title {
  margin: 0 0 0.5rem;
  font-size: clamp(1.8rem, 5vw, 2.8rem);
  font-weight: 800;
}

.ef-subtitle,
.ef-muted,
.ef-note {
  margin: 0;
  color: var(--pb-text-muted);
}

.ef-skeleton {
  height: 460px;
  border-radius: var(--pb-radius-lg);
}

/* ---------- Game panel ---------- */

.ef-game {
  scroll-margin-top: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
  padding: 1.25rem;
  border-radius: var(--pb-radius-lg);
  border: 1px solid var(--pb-border);
  background: var(--pb-surface);
  box-shadow: var(--pb-shadow-card);
}

.ef-run {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
}

.ef-level {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
}

.ef-points strong {
  font-family: var(--pb-font-display);
}

.ef-chip {
  margin-left: auto;
  padding: 0.15rem 0.6rem;
  border-radius: 999px;
  border: 1px solid var(--pb-border-strong);
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--pb-text-muted);
}

.ef-chip.paid {
  border-color: var(--pb-coin);
  color: var(--pb-text);
}

/* ---------- Board: 5x5 tiles + a hint at the end of each row / column ---------- */

.ef-board {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: clamp(0.25rem, 1.2vw, 0.45rem);
  width: 100%;
  /* The whole board fits above the phone tab bar */
  max-width: min(440px, 58svh);
  margin: 0 auto;
}

.ef-tile,
.ef-hint,
.ef-corner {
  aspect-ratio: 1;
  min-width: 0;
  border-radius: var(--pb-radius-sm);
}

.ef-tile {
  position: relative;
  padding: 0;
  border: 1px solid var(--pb-border-strong);
  background: var(--pb-bg-elevated);
  color: var(--pb-text);
  cursor: pointer;
  overflow: hidden;
  transition:
    transform 0.15s var(--pb-ease-out),
    border-color 0.15s;
}

.ef-tile:disabled {
  cursor: default;
}

/* Face-down: a sliver of foil */
.ef-back {
  position: absolute;
  inset: 0;
}

.ef-back::before {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--pb-holo);
  opacity: 0.14;
}

@media (hover: hover) {
  .ef-tile:not(:disabled):hover {
    transform: translateY(-2px);
    border-color: var(--pb-ring);
  }
}

.ef-tile:focus-visible {
  outline: 2px solid var(--pb-focus);
  outline-offset: 2px;
}

.ef-board.memo .ef-tile:not(.is-up) {
  border-style: dashed;
  border-color: var(--pb-accent);
}

/* Memo marks, in the corners of a hidden tile */
.ef-marks {
  position: absolute;
  inset: 3px;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  place-items: center;
  font-size: clamp(0.55rem, 2.2vw, 0.75rem);
  font-weight: 800;
  color: var(--pb-text-muted);
}

.ef-face {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: var(--pb-surface-hover);
}

.ef-value {
  font-family: var(--pb-font-display);
  font-size: clamp(1.05rem, 5vw, 1.6rem);
  font-weight: 800;
}

.ef-tile.is-bonus .ef-value {
  background: var(--pb-holo-text);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.ef-tile.is-bonus {
  border-color: var(--pb-accent);
}

.ef-tile.is-electrode {
  border-color: var(--pb-danger-text);
}

.ef-tile.is-electrode .ef-face {
  background: var(--pb-danger-bg);
}

.ef-tile.is-missed {
  opacity: 0.5;
}

.ef-tile.just-flipped .ef-face {
  animation: ef-flip 0.3s var(--pb-ease-out) both;
}

.ef-tile.just-flipped.is-electrode {
  animation: ef-boom 0.45s var(--pb-ease-out) both;
}

/* Row / column hints */
.ef-hint,
.ef-corner {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.1rem;
  border: 1px solid var(--pb-border);
  background: var(--pb-surface);
  line-height: 1;
}

.ef-hint strong {
  font-family: var(--pb-font-display);
  font-size: clamp(0.8rem, 3.4vw, 1.05rem);
}

.ef-hint-e {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  font-size: clamp(0.7rem, 2.8vw, 0.85rem);
  font-weight: 700;
  color: var(--pb-text-muted);
}

/* No Electrode in the line: everything there is free */
.ef-hint.is-safe {
  border-color: var(--pb-success-text);
  background: var(--pb-success-bg);
}

/* Only 1s and Electrodes: nothing to gain there */
.ef-hint.is-dud {
  opacity: 0.6;
}

.ef-corner {
  border: 0;
  background: none;
}

/* The shiny Electrode: blue top, white bottom, two angry eyes */
.ef-electrode {
  position: relative;
  display: inline-block;
  width: 62%;
  aspect-ratio: 1;
  border-radius: 50%;
  border: 2px solid var(--pb-electrode-edge);
  background: linear-gradient(180deg, var(--pb-electrode-top) 0 48%, var(--pb-electrode-edge) 48% 54%, var(--pb-electrode-bottom) 54%);
}

.ef-electrode i {
  position: absolute;
  top: 30%;
  width: 22%;
  height: 12%;
  border-radius: 2px;
  background: var(--pb-electrode-bottom);
  border: 1px solid var(--pb-electrode-edge);
}

.ef-electrode i:first-child {
  left: 20%;
  transform: rotate(20deg);
}

.ef-electrode i:last-child {
  right: 20%;
  transform: rotate(-20deg);
}

.ef-electrode.tiny {
  width: 0.7em;
  border-width: 1px;
}

.ef-electrode.tiny i {
  display: none;
}

.ef-corner .ef-electrode {
  width: 55%;
}

/* ---------- Tools ---------- */

.ef-tools {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.ef-memo[aria-pressed='true'] {
  border-color: var(--pb-accent);
  background: var(--pb-selected);
  color: var(--pb-text);
}

.ef-memo-marks {
  display: inline-flex;
  gap: 0.25rem;
}

.ef-memo-mark {
  display: inline-grid;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  padding: 0;
  border-radius: var(--pb-radius-sm);
  border: 1px solid var(--pb-border-strong);
  background: var(--pb-bg-elevated);
  color: var(--pb-text);
  font-weight: 800;
}

.ef-memo-mark .ef-electrode.tiny {
  width: 1.1rem;
}

.ef-memo-mark[aria-pressed='true'] {
  border-color: var(--pb-accent);
  box-shadow: 0 0 0 2px var(--pb-ring);
}

.ef-feedback {
  min-height: 1.25rem;
  margin: 0;
  font-size: 0.9rem;
  text-align: center;
  color: var(--pb-text-muted);
}

/* ---------- End + start ---------- */

.ef-over {
  padding: 1.25rem;
  border-radius: var(--pb-radius-lg);
  border: 1px solid var(--pb-border-strong);
  background: var(--pb-bg-elevated);
  text-align: center;
  animation: pb-rise 0.4s var(--pb-ease-out) both;
}

.ef-over.is-won {
  border-color: var(--pb-success-text);
}

.ef-over.is-lost {
  border-color: var(--pb-danger-text);
}

.ef-over-title {
  margin: 0 0 0.5rem;
  font-size: 1.3rem;
  font-weight: 800;
}

.ef-over-line,
.ef-record {
  margin: 0.25rem 0 0;
}

.ef-record {
  font-weight: 800;
}

.ef-start {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  text-align: center;
}

/* ---------- Stats + rules ---------- */

.ef-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
  margin: 0;
}

.ef-stats > div {
  min-width: 0;
  padding: 0.75rem;
  border-radius: var(--pb-radius-md);
  border: 1px solid var(--pb-border);
  background: var(--pb-surface);
}

.ef-stats dt {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--pb-text-muted);
}

.ef-stats dd {
  margin: 0.25rem 0 0;
  white-space: nowrap;
  font-family: var(--pb-font-display);
  font-size: 1.15rem;
  font-weight: 700;
}

.ef-of {
  font-size: 0.8rem;
  color: var(--pb-text-muted);
}

.ef-rules {
  padding: 1rem 1.25rem;
  border-radius: var(--pb-radius-lg);
  border: 1px solid var(--pb-border);
  background: var(--pb-surface);
}

.ef-rules-title {
  margin: 0 0 0.5rem;
  font-size: 1rem;
  font-weight: 700;
}

.ef-rules ul {
  margin: 0;
  padding-left: 1.1rem;
  color: var(--pb-text-muted);
}

.ef-back-link {
  align-self: flex-start;
  font-weight: 700;
}

@keyframes ef-flip {
  from {
    transform: scaleX(0);
  }
}

@keyframes ef-boom {
  0% {
    transform: scale(1);
  }
  30% {
    transform: scale(1.18) rotate(-6deg);
  }
  55% {
    transform: scale(0.95) rotate(5deg);
  }
  100% {
    transform: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ef-tile.just-flipped .ef-face,
  .ef-tile.just-flipped.is-electrode,
  .ef-over {
    animation: none;
  }
}
</style>
