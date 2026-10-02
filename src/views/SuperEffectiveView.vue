<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { resetTimeLabel } from '@/utils/challenge'
import * as sfx from '@/lib/sfx'
import { useChallengeStore } from '@/stores/challenge'
import { useSettingsStore } from '@/stores/settings'
import { useSuperEffectiveStore } from '@/stores/superEffective'
import { ANSWER_SECONDS, COINS_PER_ANSWER, MAX_PAID_ANSWERS, PAID_RUNS, nextAnswerReward, optionIndexForKey } from '@/utils/superEffective'
import AppHeader from '@/components/AppHeader.vue'
import CoinAmount from '@/components/CoinAmount.vue'

// "Super effective!" (challenge mode, migration 0015): a Pokémon card, tap
// the type it's weak to before the timer runs out. Only the top of the card
// shows (its weakness is printed at the bottom). The server draws the cards,
// keeps the answer until the pick and pays the paid runs. The card on screen
// (`shown`) stays put while the answer shows, even though the store already
// holds the next one.
const REVEAL_MS = 1400

const { t, te, locale } = useI18n()
// The daily reset (00:00 UTC) in the player's own time
const resetTime = computed(() => resetTimeLabel(locale.value))
const game = useSuperEffectiveStore()
const challenge = useChallengeStore()
const settings = useSettingsStore()

const shown = ref(null) // the run as on screen: { paid, streak, coins, card, options }
const reveal = ref(null) // { pick, answer, weaknesses, correct, late, earned }
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

const typeLabel = (type) => (te(`collection.types.${type}`) ? t(`collection.types.${type}`) : type)

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
      answer: result.answer,
      weaknesses: result.weaknesses ?? [result.answer],
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
  if (event.ctrlKey || event.metaKey || event.altKey) return
  const options = shown.value?.options ?? []
  const index = optionIndexForKey(event.key, options.length)
  if (index >= 0) answer(options[index])
}

// The next card's picture loads while the answer shows
watch(
  () => game.run,
  (run) => {
    if (run?.card?.image_small) new Image().src = run.card.image_small
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
const weakList = computed(() => (reveal.value?.weaknesses ?? []).map(typeLabel).join(', '))

function optionClass(type) {
  if (!reveal.value) return null
  return {
    'is-answer': type === reveal.value.answer,
    'is-wrong': type === reveal.value.pick && !reveal.value.correct,
  }
}
</script>

<template>
  <div class="pb-page">
    <AppHeader />

    <main class="container se">
      <header class="se-head">
        <h1 class="se-title">{{ t('superEffective.title') }}</h1>
        <p class="se-subtitle">{{ t('superEffective.subtitle') }}</p>
      </header>

      <p v-if="game.unavailable" class="se-note">{{ t('superEffective.unavailable') }}</p>
      <div v-else-if="game.error" class="alert alert-danger" role="alert">{{ t('superEffective.loadError') }}</div>
      <div v-else-if="!game.loaded" class="pb-skeleton se-skeleton" aria-busy="true"></div>

      <template v-else>
        <div v-if="errorMessage" class="alert alert-danger" role="alert">{{ errorMessage }}</div>

        <!-- ============ The question ============ -->
        <section v-if="shown" ref="gameEl" class="se-game" aria-labelledby="se-question">
          <div class="se-run">
            <span class="se-streak">{{ t('minigame.streak', { count: streakNow }) }}</span>
            <span v-if="shown.paid" class="se-run-coins"><CoinAmount :amount="runCoins" signed /></span>
            <span class="se-chip" :class="{ paid: shown.paid }">{{ shown.paid ? t('minigame.paidRun') : t('minigame.freeRun') }}</span>
          </div>

          <div
            class="se-timer"
            :class="{ urgent: secondsLeft <= 3 && !reveal }"
            role="progressbar"
            :aria-label="t('minigame.timeLeft')"
            aria-valuemin="0"
            :aria-valuemax="answerSeconds"
            :aria-valuenow="Math.ceil(secondsLeft)"
          >
            <span :style="{ width: `${(secondsLeft / answerSeconds) * 100}%` }"></span>
          </div>

          <figure class="se-card">
            <!-- The top of the card only: the weakness is printed at the bottom -->
            <span class="se-art">
              <img :src="shown.card.image_small" alt="" width="245" height="342" draggable="false" />
            </span>
            <figcaption>
              <span class="se-card-name">{{ shown.card.name }}</span>
              <span class="se-card-types">
                <span v-for="type in shown.card.types ?? []" :key="type" class="se-type">
                  <span class="se-dot" :style="{ '--dot': `var(--pb-type-${type.toLowerCase()})` }" aria-hidden="true"></span>
                  {{ typeLabel(type) }}
                </span>
              </span>
            </figcaption>
          </figure>

          <h2 id="se-question" class="se-question">{{ t('superEffective.question') }}</h2>

          <div class="se-options">
            <!-- Keyed by position: a key changing with each question made Vue
                 patch detached nodes in "Higher or lower" -->
            <button
              v-for="(type, i) in shown.options"
              :key="i"
              type="button"
              class="se-option"
              :class="optionClass(type)"
              :data-type="type"
              :disabled="busy || !!reveal || !!over"
              @click="answer(type)"
            >
              <span class="se-dot" :style="{ '--dot': `var(--pb-type-${type.toLowerCase()})` }" aria-hidden="true"></span>
              <span class="se-option-label">{{ typeLabel(type) }}</span>
              <kbd class="se-key" aria-hidden="true">{{ i + 1 }}</kbd>
            </button>
          </div>

          <p class="se-feedback" role="status" aria-live="polite">
            <template v-if="reveal?.correct">
              <strong class="se-right">{{ t('superEffective.right') }}</strong>
              <CoinAmount v-if="reveal.earned" :amount="reveal.earned" signed />
            </template>
            <template v-else-if="reveal">
              <strong class="se-wrong">{{ reveal.late ? t('minigame.late') : t('superEffective.wrong') }}</strong>
              <span>{{ t('superEffective.weakTo', { types: weakList }) }}</span>
            </template>
            <template v-else-if="nextReward">
              {{ t('minigame.nextReward') }} <CoinAmount :amount="nextReward" signed />
            </template>
            <template v-else>{{ t('superEffective.keys', { count: shown.options.length }) }}</template>
          </p>
        </section>

        <!-- ============ End of a run ============ -->
        <section v-if="over" class="se-over" aria-labelledby="se-over-title">
          <h2 id="se-over-title" class="se-over-title">{{ over.late ? t('minigame.overLate') : t('minigame.overTitle') }}</h2>
          <p class="se-over-streak">{{ t('minigame.overStreak', { count: over.streak }, over.streak) }}</p>
          <p v-if="over.record" class="se-record"><span class="pb-holo-text">{{ t('minigame.record') }}</span></p>
          <p v-if="over.paid" class="se-over-coins">{{ t('minigame.overCoins') }} <CoinAmount :amount="over.coins" signed /></p>
        </section>

        <!-- ============ Start ============ -->
        <section v-if="!shown || over" class="se-start">
          <button type="button" class="btn btn-primary btn-lg glow-button" :disabled="busy" @click="start">
            {{ over ? t('minigame.playAgain') : t('minigame.play') }}
          </button>
          <p class="se-muted">
            {{ game.paidLeft ? t('minigame.nextPaid', { count: game.paidLeft }, game.paidLeft) : t('minigame.nextFree') }}
          </p>
        </section>

        <dl class="se-stats">
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
        <section class="se-rules" aria-labelledby="se-rules-title">
          <h2 id="se-rules-title" class="se-rules-title">{{ t('minigame.rulesTitle') }}</h2>
          <ul>
            <li>{{ t('superEffective.rules.pick', { seconds: rules.seconds }) }}</li>
            <li>{{ t('superEffective.rules.weakness') }}</li>
            <li>{{ t('minigame.rules.run') }}</li>
            <li>{{ t('minigame.rules.paid', { runs: rules.runs, coins: rules.coins, answers: rules.answers, max: rules.coins * rules.answers }) }}</li>
            <li>{{ t('minigame.rules.free', { time: resetTime }) }}</li>
            <li>{{ t('superEffective.rules.harder') }}</li>
          </ul>
        </section>
      </template>

      <RouterLink :to="{ name: 'challenge-games' }" class="se-back"><span aria-hidden="true">←</span> {{ t('games.back') }}</RouterLink>
    </main>
  </div>
</template>

<style scoped>
.se {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding-top: 1rem;
}

.se-head {
  animation: pb-rise 0.6s var(--pb-ease-out) both;
}

.se-title {
  margin: 0 0 0.5rem;
  font-size: clamp(1.8rem, 5vw, 2.8rem);
  font-weight: 800;
}

.se-subtitle,
.se-muted,
.se-note {
  margin: 0;
  color: var(--pb-text-muted);
}

.se-skeleton {
  height: 420px;
  border-radius: var(--pb-radius-lg);
}

/* ---------- Stats ---------- */

.se-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.5rem;
  margin: 0;
}

.se-stats > div {
  min-width: 0;
  padding: 0.75rem;
  border-radius: var(--pb-radius-md);
  border: 1px solid var(--pb-border);
  background: var(--pb-surface);
}

.se-stats dt {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--pb-text-muted);
}

.se-stats dd {
  margin: 0.25rem 0 0;
  font-family: var(--pb-font-display);
  font-size: 1.15rem;
  font-weight: 700;
}

/* ---------- Question ---------- */

.se-game {
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

.se-run {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
}

.se-streak {
  font-family: var(--pb-font-display);
  font-weight: 700;
}

.se-chip {
  margin-left: auto;
  padding: 0.15rem 0.6rem;
  border-radius: 999px;
  border: 1px solid var(--pb-border-strong);
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--pb-text-muted);
}

.se-chip.paid {
  border-color: var(--pb-coin);
  color: var(--pb-text);
}

.se-timer {
  height: 6px;
  border-radius: 999px;
  background: var(--pb-border);
  overflow: hidden;
}

.se-timer span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--pb-accent);
  transition: width 0.1s linear;
}

.se-timer.urgent span {
  background: var(--pb-danger-text);
}

.se-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  width: min(15rem, 62vw, 34svh);
  margin: 0 auto;
}

/* Name, HP, type and art: roughly the top half of any card */
.se-art {
  display: block;
  width: 100%;
  aspect-ratio: 245 / 175;
  overflow: hidden;
  border-radius: 4.5% 4.5% 0 0 / 6.3% 6.3% 0 0;
  background: var(--pb-border);
  box-shadow: var(--pb-shadow-card);
  /* Fades out where the card is cut */
  mask-image: linear-gradient(to bottom, #000 82%, transparent);
}

.se-art img {
  display: block;
  width: 100%;
  height: auto;
}

.se-card figcaption {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
  max-width: 100%;
  text-align: center;
}

.se-card-name {
  max-width: 100%;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.se-card-types {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.25rem 0.75rem;
  font-size: 0.85rem;
  color: var(--pb-text-muted);
}

.se-type {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.se-dot {
  flex: none;
  width: 0.8rem;
  height: 0.8rem;
  border-radius: 50%;
  background: var(--dot, var(--pb-type-colorless));
  box-shadow: 0 0 0 1px var(--pb-border-strong);
}

.se-question {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 700;
  text-align: center;
}

.se-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
  width: 100%;
  max-width: 30rem;
  margin: 0 auto;
}

.se-option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  min-height: 2.9rem;
  padding: 0.5rem 0.75rem;
  border-radius: var(--pb-radius-md);
  border: 2px solid var(--pb-border-strong);
  background: var(--pb-bg-elevated);
  color: var(--pb-text);
  font-weight: 700;
  text-align: left;
  cursor: pointer;
  transition:
    transform 0.2s var(--pb-ease-out),
    border-color 0.2s,
    opacity 0.2s;
}

.se-option:disabled {
  cursor: default;
}

@media (hover: hover) {
  .se-option:not(:disabled):hover {
    transform: translateY(-2px);
    border-color: var(--pb-ring);
  }
}

.se-option:focus-visible {
  outline: 2px solid var(--pb-focus);
  outline-offset: 2px;
}

.se-option-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Number keys are a keyboard thing */
.se-key {
  display: none;
  padding: 0 0.35rem;
  border-radius: 4px;
  border: 1px solid var(--pb-border-strong);
  background: transparent;
  color: var(--pb-text-muted);
  font-size: 0.7rem;
}

@media (hover: hover) and (pointer: fine) {
  .se-key {
    display: inline-block;
  }
}

.se-option.is-answer {
  border-color: var(--pb-success-text);
  background: var(--pb-success-bg);
  color: var(--pb-success-text);
  animation: se-pop 0.35s var(--pb-ease-out) both;
}

.se-option.is-wrong {
  border-color: var(--pb-danger-text);
  background: var(--pb-danger-bg);
  color: var(--pb-danger-text);
}

.se-option:not(.is-answer):not(.is-wrong):disabled {
  opacity: 0.6;
}

.se-feedback {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  align-items: center;
  gap: 0.25rem 0.5rem;
  min-height: 1.75rem;
  margin: 0;
  color: var(--pb-text-muted);
  text-align: center;
}

.se-right {
  color: var(--pb-success-text);
}

.se-wrong {
  color: var(--pb-danger-text);
}

/* ---------- End + start ---------- */

.se-over {
  padding: 1.25rem;
  border-radius: var(--pb-radius-lg);
  border: 1px solid var(--pb-border-strong);
  background: var(--pb-bg-elevated);
  text-align: center;
  animation: pb-rise 0.4s var(--pb-ease-out) both;
}

.se-over-title {
  margin: 0 0 0.5rem;
  font-size: 1.3rem;
  font-weight: 800;
}

.se-over-streak,
.se-over-coins,
.se-record {
  margin: 0.25rem 0 0;
}

.se-record {
  font-weight: 800;
}

.se-start {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  text-align: center;
}

/* ---------- Rules ---------- */

.se-rules {
  padding: 1rem 1.25rem;
  border-radius: var(--pb-radius-lg);
  border: 1px solid var(--pb-border);
  background: var(--pb-surface);
}

.se-rules-title {
  margin: 0 0 0.5rem;
  font-size: 1rem;
  font-weight: 700;
}

.se-rules ul {
  margin: 0;
  padding-left: 1.1rem;
  color: var(--pb-text-muted);
}

.se-back {
  align-self: flex-start;
  font-weight: 700;
}

@keyframes se-pop {
  50% {
    transform: scale(1.05);
  }
}

@media (prefers-reduced-motion: reduce) {
  .se-option.is-answer,
  .se-over {
    animation: none;
  }
}
</style>
