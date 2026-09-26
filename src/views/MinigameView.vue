<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import * as sfx from '@/lib/sfx'
import { useChallengeStore } from '@/stores/challenge'
import { useMinigameStore } from '@/stores/minigame'
import { useSettingsStore } from '@/stores/settings'
import { ANSWER_SECONDS, COINS_PER_ANSWER, MAX_PAID_ANSWERS, PAID_RUNS, nextAnswerReward, pricierSide } from '@/utils/minigame'
import AppHeader from '@/components/AppHeader.vue'
import CoinAmount from '@/components/CoinAmount.vue'

// "Higher or lower" (challenge mode, migration 0013): two cards, tap the
// one worth more before the timer runs out. The server draws the pairs,
// keeps the prices until the answer and pays the paid runs. The pair on
// screen (`shown`) stays put while its prices are revealed, even though the
// store already holds the next one.
const SIDES = ['left', 'right']
const REVEAL_MS = 1400

const { t, locale } = useI18n()
const game = useMinigameStore()
const challenge = useChallengeStore()
const settings = useSettingsStore()

const shown = ref(null) // the run as on screen: { paid, streak, coins, left, right }
const reveal = ref(null) // { pick, left, right (prices), correct, late, earned }
const over = ref(null) // { streak, coins, paid, late, record }
const busy = ref(false)
const errorMessage = ref('')
const secondsLeft = ref(0)
const bestBefore = ref(0)
const gameEl = ref(null)

const answerSeconds = computed(() => game.state?.answer_seconds ?? ANSWER_SECONDS)
const rules = computed(() => ({
  runs: game.state?.paid_runs ?? PAID_RUNS,
  coins: game.state?.coins_per_answer ?? COINS_PER_ANSWER,
  answers: game.state?.max_paid_answers ?? MAX_PAID_ANSWERS,
  seconds: answerSeconds.value,
}))

// ---------- Timer ----------

let deadline = 0
let ticker = null
let revealTimer = null

function startTimer(seconds) {
  stopTimer()
  deadline = performance.now() + seconds * 1000
  secondsLeft.value = seconds
  ticker = setInterval(() => {
    secondsLeft.value = Math.max(0, (deadline - performance.now()) / 1000)
    if (secondsLeft.value === 0) {
      stopTimer()
      answer(null)
    }
  }, 100)
}

function stopTimer() {
  clearInterval(ticker)
  ticker = null
}

// ---------- Flow ----------

function showRun(run) {
  reveal.value = null
  shown.value = run ? { ...run } : null
  if (run) startTimer(run.seconds_left ?? answerSeconds.value)
}

const errorFor = (err) => t(err?.code ? `challenge.errors.${err.code}` : 'challenge.errors.generic')

async function start() {
  if (busy.value) return
  busy.value = true
  errorMessage.value = ''
  bestBefore.value = game.best
  try {
    await game.start()
    over.value = null
    showRun(game.run)
    // The whole question fits on a phone screen once scrolled to it
    nextTick(() => gameEl.value?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }))
  } catch (err) {
    errorMessage.value = errorFor(err)
  } finally {
    busy.value = false
  }
}

async function answer(pick) {
  if (busy.value || reveal.value || !shown.value) return
  busy.value = true
  stopTimer()
  try {
    const result = await game.answer(pick)
    reveal.value = {
      pick,
      left: result.left.value,
      right: result.right.value,
      correct: result.correct,
      late: result.late,
      earned: result.earned,
    }
    if (result.correct) {
      sfx.flip(settings.sound)
      if (result.earned) sfx.rare(settings.sound)
      revealTimer = setTimeout(() => showRun(game.run), REVEAL_MS)
    } else {
      sfx.buzz(settings.vibration)
      over.value = {
        streak: result.streak,
        coins: result.run_coins,
        paid: shown.value.paid,
        late: result.late,
        record: result.streak > 0 && result.streak > bestBefore.value,
      }
    }
  } catch (err) {
    errorMessage.value = errorFor(err)
    // The run is gone server side (closed after a long pause): back to the start
    if (err?.code === 'no_game') {
      shown.value = null
      game.load()
    }
  } finally {
    busy.value = false
  }
}

function onKey(event) {
  if (event.key === 'ArrowLeft') answer('left')
  else if (event.key === 'ArrowRight') answer('right')
}

// The next pair's pictures load while the current prices show
watch(
  () => game.run,
  (run) => {
    for (const side of SIDES) {
      if (run?.[side]?.image_small) new Image().src = run[side].image_small
    }
  },
)

onMounted(async () => {
  challenge.load() // the header's coins
  window.addEventListener('keydown', onKey)
  await game.load()
  bestBefore.value = game.best
  if (game.run) showRun(game.run) // resumed after a reload, same time limit
})

onBeforeUnmount(() => {
  stopTimer()
  clearTimeout(revealTimer)
  window.removeEventListener('keydown', onKey)
})

// ---------- Display ----------

const streakNow = computed(() => (shown.value?.streak ?? 0) + (reveal.value?.correct ? 1 : 0))
const runCoins = computed(() => (shown.value?.coins ?? 0) + (reveal.value?.earned ?? 0))
const nextReward = computed(() => nextAnswerReward(shown.value))
const pricier = computed(() => (reveal.value ? pricierSide(reveal.value.left, reveal.value.right) : null))

function sideClass(side) {
  if (!reveal.value) return null
  return {
    'is-pricier': side === pricier.value,
    'is-wrong': side === reveal.value.pick && !reveal.value.correct,
    'is-picked': side === reveal.value.pick,
  }
}

const formatPrice = (value) =>
  new Intl.NumberFormat(locale.value, { style: 'currency', currency: 'EUR', maximumFractionDigits: value < 10 ? 2 : 0 }).format(value ?? 0)
</script>

<template>
  <div class="pb-page">
    <AppHeader />

    <main class="container mg">
      <header class="mg-head">
        <span class="pb-eyebrow">{{ t('minigame.eyebrow') }}</span>
        <h1 class="mg-title">{{ t('minigame.title') }}</h1>
        <p class="mg-subtitle">{{ t('minigame.subtitle') }}</p>
      </header>

      <p v-if="game.unavailable" class="mg-note">{{ t('minigame.unavailable') }}</p>
      <div v-else-if="game.error" class="alert alert-danger" role="alert">{{ t('minigame.loadError') }}</div>
      <div v-else-if="!game.loaded" class="pb-skeleton mg-skeleton" aria-busy="true"></div>

      <template v-else>

        <div v-if="errorMessage" class="alert alert-danger" role="alert">{{ errorMessage }}</div>

        <!-- ============ The question ============ -->
        <section v-if="shown" ref="gameEl" class="mg-game" aria-labelledby="mg-question">
          <div class="mg-run">
            <span class="mg-streak">{{ t('minigame.streak', { count: streakNow }) }}</span>
            <span v-if="shown.paid" class="mg-run-coins"><CoinAmount :amount="runCoins" signed /></span>
            <span class="mg-chip" :class="{ paid: shown.paid }">{{ shown.paid ? t('minigame.paidRun') : t('minigame.freeRun') }}</span>
          </div>

          <h2 id="mg-question" class="mg-question">{{ t('minigame.question') }}</h2>

          <div
            class="mg-timer"
            :class="{ urgent: secondsLeft <= 5 && !reveal }"
            role="progressbar"
            :aria-label="t('minigame.timeLeft')"
            aria-valuemin="0"
            :aria-valuemax="answerSeconds"
            :aria-valuenow="Math.ceil(secondsLeft)"
          >
            <span :style="{ width: `${(secondsLeft / answerSeconds) * 100}%` }"></span>
          </div>

          <div class="mg-cards">
            <!-- Keyed by side only: SIDES is a constant, so Vue compiles a
                 stable list; a key changing with each pair made it patch
                 detached nodes (prices never showed after the first pair) -->
            <button
              v-for="side in SIDES"
              :key="side"
              type="button"
              class="mg-card"
              :class="sideClass(side)"
              :data-side="side"
              :disabled="busy || !!reveal || !!over"
              @click="answer(side)"
            >
              <span class="mg-card-img">
                <img :src="shown[side].image_small" alt="" width="245" height="342" draggable="false" />
              </span>
              <span class="mg-card-name">{{ shown[side].name }}</span>
              <span class="mg-card-set">{{ shown[side].set_name }}</span>
              <span v-if="reveal" class="mg-price">{{ formatPrice(reveal[side]) }}</span>
            </button>
          </div>

          <p class="mg-feedback" role="status" aria-live="polite">
            <template v-if="reveal?.correct">
              <strong class="mg-right">{{ t('minigame.right') }}</strong>
              <CoinAmount v-if="reveal.earned" :amount="reveal.earned" signed />
            </template>
            <strong v-else-if="reveal?.late" class="mg-wrong">{{ t('minigame.late') }}</strong>
            <strong v-else-if="reveal" class="mg-wrong">{{ t('minigame.wrong') }}</strong>
            <template v-else-if="nextReward">
              {{ t('minigame.nextReward') }} <CoinAmount :amount="nextReward" signed />
            </template>
            <template v-else>{{ t('minigame.keys') }}</template>
          </p>
        </section>

        <!-- ============ End of a run ============ -->
        <section v-if="over" class="mg-over" aria-labelledby="mg-over-title">
          <h2 id="mg-over-title" class="mg-over-title">{{ over.late ? t('minigame.overLate') : t('minigame.overTitle') }}</h2>
          <p class="mg-over-streak">{{ t('minigame.overStreak', { count: over.streak }, over.streak) }}</p>
          <p v-if="over.record" class="mg-record"><span class="pb-holo-text">{{ t('minigame.record') }}</span></p>
          <p v-if="over.paid" class="mg-over-coins">{{ t('minigame.overCoins') }} <CoinAmount :amount="over.coins" signed /></p>
        </section>

        <!-- ============ Start ============ -->
        <section v-if="!shown || over" class="mg-start">
          <button type="button" class="btn btn-primary btn-lg glow-button" :disabled="busy" @click="start">
            {{ over ? t('minigame.playAgain') : t('minigame.play') }}
          </button>
          <p class="mg-muted">
            {{ game.paidLeft ? t('minigame.nextPaid', { count: game.paidLeft }, game.paidLeft) : t('minigame.nextFree') }}
          </p>
        </section>

        <dl class="mg-stats">
          <div>
            <dt>{{ t('minigame.paidLeft') }}</dt>
            <dd>{{ game.paidLeft }} / {{ rules.runs }}</dd>
          </div>
          <div>
            <dt>{{ t('minigame.todayCoins') }}</dt>
            <dd><CoinAmount :amount="game.state.today_coins" /></dd>
          </div>
          <div>
            <dt>{{ t('minigame.best') }}</dt>
            <dd>{{ game.best }}</dd>
          </div>
        </dl>

        <!-- ============ Rules ============ -->
        <section class="mg-rules" aria-labelledby="mg-rules-title">
          <h2 id="mg-rules-title" class="mg-rules-title">{{ t('minigame.rulesTitle') }}</h2>
          <ul>
            <li>{{ t('minigame.rules.pick', { seconds: rules.seconds }) }}</li>
            <li>{{ t('minigame.rules.run') }}</li>
            <li>{{ t('minigame.rules.paid', { runs: rules.runs, coins: rules.coins, answers: rules.answers, max: rules.coins * rules.answers }) }}</li>
            <li>{{ t('minigame.rules.free') }}</li>
            <li>{{ t('minigame.rules.harder') }}</li>
          </ul>
        </section>
      </template>

      <RouterLink :to="{ name: 'challenge-games' }" class="mg-back"><span aria-hidden="true">←</span> {{ t('games.back') }}</RouterLink>
    </main>
  </div>
</template>

<style scoped>
.mg {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding-top: 1rem;
}

.mg-head {
  animation: pb-rise 0.6s var(--pb-ease-out) both;
}

.mg-title {
  margin: 0.75rem 0 0.5rem;
  font-size: clamp(1.8rem, 5vw, 2.8rem);
  font-weight: 800;
}

.mg-subtitle,
.mg-muted,
.mg-note {
  margin: 0;
  color: var(--pb-text-muted);
}

.mg-skeleton {
  height: 420px;
  border-radius: var(--pb-radius-lg);
}

/* ---------- Stats ---------- */

.mg-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
  margin: 0;
}

.mg-stats > div {
  min-width: 0;
  padding: 0.75rem;
  border-radius: var(--pb-radius-md);
  border: 1px solid var(--pb-border);
  background: var(--pb-surface);
}

.mg-stats dt {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--pb-text-muted);
}

.mg-stats dd {
  margin: 0.25rem 0 0;
  font-family: var(--pb-font-display);
  font-size: 1.15rem;
  font-weight: 700;
}

/* ---------- Question ---------- */

.mg-game {
  scroll-margin-top: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 1.25rem;
  border-radius: var(--pb-radius-lg);
  border: 1px solid var(--pb-border);
  background: var(--pb-surface);
  box-shadow: var(--pb-shadow-card);
  min-width: 0;
}

.mg-run {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
}

.mg-streak {
  font-family: var(--pb-font-display);
  font-weight: 700;
}

.mg-chip {
  margin-left: auto;
  padding: 0.15rem 0.6rem;
  border-radius: 999px;
  border: 1px solid var(--pb-border-strong);
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--pb-text-muted);
}

.mg-chip.paid {
  border-color: var(--pb-coin);
  color: var(--pb-text);
}

.mg-question {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
  text-align: center;
}

.mg-timer {
  height: 6px;
  border-radius: 999px;
  background: var(--pb-border);
  overflow: hidden;
}

.mg-timer span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--pb-accent);
  transition: width 0.1s linear;
}

.mg-timer.urgent span {
  background: var(--pb-danger-text);
}

.mg-cards {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  /* Cards at most ~36% of the screen height: question, cards, prices and
     feedback fit above the phone tab bar */
  max-width: min(560px, 52svh);
  width: 100%;
  margin: 0 auto;
}

.mg-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  min-width: 0;
  padding: 0.5rem 0.5rem 0.75rem;
  border-radius: var(--pb-radius-md);
  border: 2px solid transparent;
  background: transparent;
  color: var(--pb-text);
  text-align: center;
  cursor: pointer;
  transition:
    transform 0.2s var(--pb-ease-out),
    border-color 0.2s,
    opacity 0.2s;
}

.mg-card:disabled {
  cursor: default;
}

@media (hover: hover) {
  .mg-card:not(:disabled):hover {
    transform: translateY(-4px);
    border-color: var(--pb-ring);
  }
}

.mg-card:focus-visible {
  outline: 2px solid var(--pb-focus);
  outline-offset: 2px;
}

.mg-card-img {
  display: block;
  width: 100%;
  aspect-ratio: 245 / 342;
  border-radius: 4.5% / 3.2%;
  overflow: hidden;
  background: var(--pb-border);
  box-shadow: var(--pb-shadow-card);
}

.mg-card-img img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.mg-card-name {
  max-width: 100%;
  margin-top: 0.25rem;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mg-card-set {
  max-width: 100%;
  font-size: 0.8rem;
  color: var(--pb-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mg-price {
  margin-top: 0.25rem;
  padding: 0.1rem 0.6rem;
  border-radius: 999px;
  font-family: var(--pb-font-display);
  font-weight: 700;
  background: var(--pb-bg-elevated);
  animation: mg-pop 0.35s var(--pb-ease-out) both;
}

.mg-card.is-pricier {
  border-color: var(--pb-success-text);
}

.mg-card.is-pricier .mg-price {
  color: var(--pb-success-text);
  background: var(--pb-success-bg);
}

.mg-card.is-wrong {
  border-color: var(--pb-danger-text);
}

.mg-card.is-wrong .mg-price {
  color: var(--pb-danger-text);
  background: var(--pb-danger-bg);
}

.mg-card:not(.is-pricier):not(.is-wrong):disabled {
  opacity: 0.75;
}

.mg-feedback {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 0.5rem;
  min-height: 1.75rem;
  margin: 0;
  color: var(--pb-text-muted);
}

.mg-right {
  color: var(--pb-success-text);
}

.mg-wrong {
  color: var(--pb-danger-text);
}

/* ---------- End + start ---------- */

.mg-over {
  padding: 1.25rem;
  border-radius: var(--pb-radius-lg);
  border: 1px solid var(--pb-border-strong);
  background: var(--pb-bg-elevated);
  text-align: center;
  animation: pb-rise 0.4s var(--pb-ease-out) both;
}

.mg-over-title {
  margin: 0 0 0.5rem;
  font-size: 1.3rem;
  font-weight: 800;
}

.mg-over-streak,
.mg-over-coins,
.mg-record {
  margin: 0.25rem 0 0;
}

.mg-record {
  font-weight: 800;
}

.mg-start {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  text-align: center;
}

/* ---------- Rules ---------- */

.mg-rules {
  padding: 1rem 1.25rem;
  border-radius: var(--pb-radius-lg);
  border: 1px solid var(--pb-border);
  background: var(--pb-surface);
}

.mg-rules-title {
  margin: 0 0 0.5rem;
  font-size: 1rem;
  font-weight: 700;
}

.mg-rules ul {
  margin: 0;
  padding-left: 1.1rem;
  color: var(--pb-text-muted);
}

.mg-back {
  align-self: flex-start;
  font-weight: 700;
}

@keyframes mg-pop {
  from {
    transform: scale(0.6);
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .mg-price,
  .mg-over {
    animation: none;
  }
}
</style>
