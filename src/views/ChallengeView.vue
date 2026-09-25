<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useChallengeStore } from '@/stores/challenge'
import { useChallengeCollectionStore } from '@/stores/collection'
import { BUCKETS } from '@/utils/rarity'
import {
  CRAFT_PRICE,
  GOD_PACK_ODDS,
  PACK_PRICE,
  RECYCLE_VALUE,
  START_COINS,
  countdownParts,
  dailyReward,
  msUntilReset,
} from '@/utils/challenge'
import { completionPercent } from '@/utils/progress'
import AppHeader from '@/components/AppHeader.vue'
import BoosterArt from '@/components/BoosterArt.vue'
import CoinAmount from '@/components/CoinAmount.vue'
import RecycleDuplicates from '@/components/RecycleDuplicates.vue'

// Challenge mode hub: coins, daily reward, missions, and the separate
// challenge collection (with duplicate recycling).
const { t, locale } = useI18n()
const challenge = useChallengeStore()
const collection = useChallengeCollectionStore()

const firstLoad = computed(() => !challenge.loaded && !challenge.error)
const state = computed(() => challenge.state)

// ---------- Reset countdown (missions + daily reward, 00:00 UTC) ----------

const now = ref(Date.now())
let clock = null
let resetTimer = null
onMounted(() => {
  challenge.load({ force: true })
  collection.load()
  clock = setInterval(() => (now.value = Date.now()), 30_000)
  // Reload right after the reset so new missions and the reward show up
  resetTimer = setTimeout(() => challenge.load({ force: true }), msUntilReset() + 2000)
})
onBeforeUnmount(() => {
  clearInterval(clock)
  clearTimeout(resetTimer)
})

const resetIn = computed(() => {
  const { hours, minutes } = countdownParts(msUntilReset(new Date(now.value)))
  return hours ? t('challenge.inHours', { hours, minutes }) : t('challenge.inMinutes', { minutes })
})

// ---------- Feedback ----------

const notice = ref('')
const errorMessage = ref('')
const busy = ref('') // action in progress: 'daily' | mission id

async function run(action, task) {
  busy.value = action
  notice.value = ''
  errorMessage.value = ''
  try {
    await task()
  } catch (err) {
    errorMessage.value = t(err.code ? `challenge.errors.${err.code}` : 'challenge.errors.generic')
    challenge.load({ force: true })
  } finally {
    busy.value = ''
  }
}

// ---------- Daily reward ----------

// The 7-day streak track; day 7 and later all pay the maximum
const streakDays = computed(() => {
  const streak = state.value?.daily_streak ?? 0
  const claimedToday = state.value && !state.value.daily_available
  // Which day of the track today's claim is (or was)
  const today = claimedToday ? streak : streak + 1
  const offset = Math.max(0, today - 7)
  return Array.from({ length: 7 }, (_, i) => {
    const day = offset + i + 1
    return { day, reward: dailyReward(day), done: day < today || (day === today && claimedToday), today: day === today }
  })
})

const claimDaily = () =>
  run('daily', async () => {
    const reward = await challenge.claimDaily()
    notice.value = t('challenge.rewardNotice', { count: reward.toLocaleString(locale.value) })
  })

// ---------- Missions ----------

const claimMission = (mission) =>
  run(mission, async () => {
    const reward = await challenge.claimMission(mission)
    notice.value = t('challenge.rewardNotice', { count: reward.toLocaleString(locale.value) })
  })

// ---------- Collection + recycling ----------

const percent = computed(() => completionPercent(collection.entries.length, collection.stats.totalCards))
const percentLabel = computed(() => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }).format(percent.value))

// Recycling moves the "recycle" mission: refresh it
function onRecycled(result) {
  errorMessage.value = ''
  notice.value = t('challenge.recycledNotice', { cards: result.recycled, coins: result.gained.toLocaleString(locale.value) }, result.recycled)
  challenge.load({ force: true })
}

function onRecycleError(err) {
  notice.value = ''
  errorMessage.value = t(err.code ? `challenge.errors.${err.code}` : 'challenge.errors.generic')
}

const formatNumber = (value) => value.toLocaleString(locale.value)
</script>

<template>
  <div class="pb-page">
    <AppHeader />

    <main class="container challenge">
      <section class="ch-intro">
        <span class="pb-eyebrow">{{ t('challenge.eyebrow') }}</span>
        <h1 class="ch-title">{{ t('challenge.title') }}</h1>
        <p class="ch-subtitle">{{ t('challenge.subtitle') }}</p>
      </section>

      <div v-if="challenge.error" class="alert alert-danger" role="alert">{{ t('challenge.loadError') }}</div>

      <div v-else-if="firstLoad" class="ch-grid" aria-busy="true">
        <div v-for="n in 4" :key="n" class="pb-skeleton" style="height: 220px; border-radius: var(--pb-radius-lg)"></div>
      </div>

      <template v-else>
        <p class="ch-feedback" role="status" aria-live="polite">
          <span v-if="notice" class="ch-notice">{{ notice }}</span>
        </p>
        <div v-if="errorMessage" class="alert alert-danger" role="alert">{{ errorMessage }}</div>

        <div class="ch-grid">
          <!-- ============ Wallet ============ -->
          <section class="ch-tile ch-wallet" aria-labelledby="ch-wallet-title">
            <div class="ch-wallet-text">
              <h2 id="ch-wallet-title" class="ch-label">{{ t('challenge.walletTitle') }}</h2>
              <p class="ch-coins"><CoinAmount :amount="challenge.coins" /></p>
              <p class="ch-muted">{{ t('challenge.affordable', { count: challenge.affordable }, challenge.affordable) }}</p>

              <RouterLink :to="{ name: 'challenge-boosters' }" class="btn btn-primary btn-lg glow-button ch-cta">
                {{ t('challenge.openCta') }}
                <span class="ch-cta-price"><CoinAmount :amount="PACK_PRICE" /></span>
              </RouterLink>
            </div>
            <div class="ch-wallet-art" aria-hidden="true">
              <BoosterArt class="ch-pack ch-pack-back" />
              <BoosterArt class="ch-pack ch-pack-front" />
            </div>
          </section>

          <!-- ============ Daily reward ============ -->
          <section class="ch-tile ch-daily" aria-labelledby="ch-daily-title">
            <h2 id="ch-daily-title" class="ch-tile-title">{{ t('challenge.dailyTitle') }}</h2>
            <p class="ch-muted">{{ t('challenge.dailyDesc') }}</p>
            <ol class="ch-streak">
              <li
                v-for="day in streakDays"
                :key="day.day"
                :class="{ done: day.done, today: day.today }"
                :aria-current="day.today ? 'date' : undefined"
              >
                <span class="ch-streak-day">{{ t('challenge.day', { day: day.day }) }}</span>
                <span class="ch-streak-reward">{{ formatNumber(day.reward) }}</span>
              </li>
            </ol>
            <button
              v-if="state.daily_available"
              type="button"
              class="btn btn-primary glow-button ch-claim"
              :disabled="busy === 'daily'"
              @click="claimDaily"
            >
              <span v-if="busy === 'daily'" class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
              {{ t('challenge.claim') }} <CoinAmount :amount="state.daily_reward" signed />
            </button>
            <p v-else class="ch-claimed">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
              {{ t('challenge.dailyClaimed', { time: resetIn }) }}
            </p>
          </section>

          <!-- ============ Missions ============ -->
          <section class="ch-tile ch-missions" aria-labelledby="ch-missions-title">
            <div class="ch-tile-head">
              <h2 id="ch-missions-title" class="ch-tile-title">{{ t('challenge.missionsTitle') }}</h2>
              <span class="ch-reset">{{ t('challenge.resetIn', { time: resetIn }) }}</span>
            </div>
            <ul class="ch-mission-list" role="list">
              <li v-for="mission in challenge.missions" :key="mission.mission" class="ch-mission" :class="{ claimed: mission.claimed }">
                <div class="ch-mission-text">
                  <p class="ch-mission-name">{{ t(`challenge.missions.${mission.mission}`, { count: mission.target }, mission.target) }}</p>
                  <div class="ch-mission-progress">
                    <div
                      class="ch-bar"
                      role="progressbar"
                      :aria-label="t(`challenge.missions.${mission.mission}`, { count: mission.target }, mission.target)"
                      aria-valuemin="0"
                      :aria-valuemax="mission.target"
                      :aria-valuenow="mission.progress"
                    >
                      <span :style="{ width: `${(mission.progress / mission.target) * 100}%` }"></span>
                    </div>
                    <span class="ch-mission-count">{{ mission.progress }}/{{ mission.target }}</span>
                  </div>
                </div>
                <span v-if="mission.claimed" class="ch-mission-done">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>
                  {{ t('challenge.claimed') }}
                </span>
                <button
                  v-else
                  type="button"
                  class="btn btn-sm ch-mission-claim"
                  :class="mission.progress >= mission.target ? 'btn-primary' : 'btn-outline-secondary'"
                  :disabled="mission.progress < mission.target || busy === mission.mission"
                  @click="claimMission(mission.mission)"
                >
                  <CoinAmount :amount="mission.reward" signed />
                  <span class="visually-hidden">{{ t('challenge.claim') }}</span>
                </button>
              </li>
            </ul>
          </section>

          <!-- ============ Challenge collection ============ -->
          <section class="ch-tile ch-collection" aria-labelledby="ch-collection-title">
            <div class="ch-tile-head">
              <h2 id="ch-collection-title" class="ch-tile-title">{{ t('challenge.collectionTitle') }}</h2>
              <RouterLink :to="{ name: 'challenge-collection' }" class="ch-link">{{ t('challenge.seeCollection') }}</RouterLink>
            </div>
            <p class="ch-big-number">
              {{ formatNumber(collection.entries.length) }}
              <span class="ch-big-number-total">/ {{ formatNumber(collection.stats.totalCards) }}</span>
            </p>
            <div class="ch-bar ch-bar-holo" role="progressbar" :aria-label="t('game.progressLabel')" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="percent">
              <span :style="{ width: `${Math.max(percent, collection.entries.length ? 1.5 : 0)}%` }"></span>
            </div>
            <p class="ch-muted mt-2">{{ t('game.progress', { percent: percentLabel }) }}</p>

            <RecycleDuplicates class="ch-recycle" @recycled="onRecycled" @error="onRecycleError" />
          </section>
        </div>

        <!-- ============ Rules ============ -->
        <details class="ch-rules">
          <summary>{{ t('challenge.rulesTitle') }}</summary>
          <ul class="ch-rules-list">
            <li>{{ t('challenge.rules.start', { coins: formatNumber(START_COINS) }) }}</li>
            <li>{{ t('challenge.rules.pack', { coins: formatNumber(PACK_PRICE) }) }}</li>
            <li>{{ t('challenge.rules.daily') }}</li>
            <li>{{ t('challenge.rules.rates') }}</li>
            <li>{{ t('challenge.rules.godPack', { odds: formatNumber(GOD_PACK_ODDS) }) }}</li>
            <li>{{ t('challenge.rules.recycle') }}</li>
            <li>{{ t('challenge.rules.separate') }}</li>
          </ul>
          <div class="ch-table-wrap">
            <table class="ch-table">
              <caption class="visually-hidden">{{ t('challenge.rules.tableCaption') }}</caption>
              <thead>
                <tr>
                  <th scope="col">{{ t('challenge.rules.rarity') }}</th>
                  <th scope="col">{{ t('challenge.rules.recycleCol') }}</th>
                  <th scope="col">{{ t('challenge.rules.craftCol') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="bucket in BUCKETS" :key="bucket">
                  <th scope="row"><span class="ch-swatch" :style="{ background: `var(--pb-bucket-${bucket})` }"></span>{{ t(`challenge.buckets.${bucket}`) }}</th>
                  <td><CoinAmount :amount="RECYCLE_VALUE[bucket]" /></td>
                  <td><CoinAmount :amount="CRAFT_PRICE[bucket]" /></td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>

        <RouterLink :to="{ name: 'game' }" class="ch-back"><span aria-hidden="true">←</span> {{ t('challenge.backToUnlimited') }}</RouterLink>
      </template>
    </main>
  </div>
</template>

<style scoped>
.challenge {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  padding-top: 1rem;
}

.ch-intro {
  animation: pb-rise 0.6s var(--pb-ease-out) both;
}

.ch-title {
  margin: 1rem 0 0.5rem;
  font-size: clamp(1.8rem, 5vw, 3rem);
  font-weight: 800;
}

.ch-subtitle {
  max-width: 40rem;
  margin: 0;
  color: var(--pb-text-muted);
  font-size: 1.05rem;
}

.ch-feedback {
  min-height: 0;
  margin: 0;
}

.ch-notice {
  display: inline-block;
  padding: 0.5rem 1rem;
  border-radius: 999px;
  background: var(--pb-success-bg);
  color: var(--pb-success-text);
  font-weight: 700;
  animation: pb-rise 0.4s var(--pb-ease-out) both;
}

/* ---------- Tiles ---------- */

.ch-grid {
  display: grid;
  gap: 1rem;
  animation: pb-rise 0.6s 0.1s var(--pb-ease-out) both;
}

.ch-tile {
  position: relative;
  padding: 1.5rem;
  border-radius: var(--pb-radius-lg);
  border: 1px solid var(--pb-border);
  background: var(--pb-surface);
  box-shadow: var(--pb-shadow-card);
  backdrop-filter: blur(14px);
  overflow: hidden;
  min-width: 0;
}

.ch-tile-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.ch-tile-title {
  margin: 0 0 0.5rem;
  font-size: 1.15rem;
}

.ch-tile-head .ch-tile-title {
  margin: 0;
}

.ch-label {
  margin: 0;
  color: var(--pb-text-muted);
  font-family: var(--pb-font-body);
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.ch-muted {
  margin: 0;
  color: var(--pb-text-muted);
  font-size: 0.95rem;
}

.ch-link {
  font-weight: 700;
  font-size: 0.9rem;
  white-space: nowrap;
}

.ch-bar {
  flex: 1;
  height: 10px;
  border-radius: 999px;
  background: var(--pb-input-bg);
  border: 1px solid var(--pb-border);
  overflow: hidden;
}

.ch-bar span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--pb-accent);
  transition: width 0.8s var(--pb-ease-out);
}

.ch-bar-holo span {
  background: var(--pb-holo);
}

/* Wallet: the feature tile */
.ch-wallet {
  display: flex;
  gap: 1.5rem;
  padding: 1.75rem;
  background:
    radial-gradient(90% 120% at 100% 0%, color-mix(in srgb, var(--pb-accent) 16%, transparent), transparent 60%),
    var(--pb-surface);
}

.ch-wallet::before {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  height: 2px;
  background: var(--pb-holo);
  opacity: 0.8;
}

.ch-wallet-text {
  flex: 1;
  min-width: 0;
}

.ch-coins {
  margin: 0.5rem 0 0.25rem;
  color: var(--pb-coin);
  font-family: var(--pb-font-display);
  font-size: clamp(2.2rem, 7vw, 3.2rem);
  font-weight: 800;
  line-height: 1.1;
}

.ch-cta {
  display: inline-flex;
  margin-top: 1.5rem;
  align-items: center;
  gap: 0.75rem;
}

.ch-cta-price {
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--pb-accent-ink) 12%, transparent);
  font-size: 0.85rem;
}

.ch-wallet-art {
  --booster-w: 64px;
  position: absolute;
  top: 1.25rem;
  right: 1.5rem;
  width: 100px;
  height: 110px;
  display: grid;
  place-items: center;
}

.ch-pack {
  position: absolute;
}

.ch-pack-back {
  transform: translateX(28%) rotate(12deg) scale(0.92);
  filter: saturate(0.8) brightness(0.85);
}

.ch-pack-front {
  transform: translateX(-18%) rotate(-8deg);
}

/* Daily streak */
.ch-streak {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 0.35rem;
  margin: 1rem 0;
  padding: 0;
  list-style: none;
}

.ch-streak li {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
  padding: 0.5rem 0.1rem;
  border-radius: var(--pb-radius-sm);
  border: 1px solid var(--pb-border);
  background: var(--pb-input-bg);
  min-width: 0;
}

.ch-streak li.done {
  border-color: transparent;
  background: color-mix(in srgb, var(--pb-accent) 22%, transparent);
}

.ch-streak li.today {
  border-color: var(--pb-ring);
  box-shadow: 0 0 0 1px var(--pb-ring);
}

.ch-streak-day {
  color: var(--pb-text-muted);
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  white-space: nowrap;
}

.ch-streak-reward {
  font-size: 0.8rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.ch-claim {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.ch-claimed,
.ch-mission-done {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  color: var(--pb-success-text);
  font-weight: 700;
  font-size: 0.9rem;
}

.ch-claimed svg,
.ch-mission-done svg {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* Missions */
.ch-reset {
  color: var(--pb-text-muted);
  font-size: 0.8rem;
  font-weight: 600;
  white-space: nowrap;
}

.ch-mission-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.ch-mission {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 0.9rem;
  border-radius: var(--pb-radius-md);
  border: 1px solid var(--pb-border);
  background: var(--pb-input-bg);
}

.ch-mission.claimed {
  opacity: 0.7;
}

.ch-mission-text {
  flex: 1;
  min-width: 0;
}

.ch-mission-name {
  margin: 0 0 0.4rem;
  font-weight: 700;
  font-size: 0.92rem;
}

.ch-mission-progress {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.ch-mission-progress .ch-bar {
  height: 8px;
}

.ch-mission-count {
  color: var(--pb-text-muted);
  font-size: 0.8rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.ch-mission-claim {
  flex-shrink: 0;
  min-width: 5.5rem;
  font-weight: 700;
}

/* Collection */
.ch-big-number {
  margin: 0 0 0.9rem;
  font-family: var(--pb-font-display);
  font-size: 2rem;
  font-weight: 800;
  line-height: 1;
}

.ch-big-number-total {
  font-size: 1rem;
  font-weight: 600;
  color: var(--pb-text-muted);
}

.ch-recycle {
  margin-top: 1.25rem;
  padding-top: 1.25rem;
  border-top: 1px solid var(--pb-border);
}

/* Rules */
.ch-rules {
  padding: 1rem 1.5rem;
  border-radius: var(--pb-radius-lg);
  border: 1px solid var(--pb-border);
  background: var(--pb-surface);
}

.ch-rules summary {
  font-family: var(--pb-font-display);
  font-weight: 700;
  cursor: pointer;
}

.ch-rules-list {
  margin: 1rem 0;
  padding-left: 1.2rem;
  color: var(--pb-text-muted);
  line-height: 1.6;
}

.ch-table-wrap {
  overflow-x: auto;
}

.ch-table {
  width: 100%;
  max-width: 32rem;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.ch-table th,
.ch-table td {
  padding: 0.45rem 0.75rem 0.45rem 0;
  border-bottom: 1px solid var(--pb-border);
  text-align: left;
  white-space: nowrap;
}

.ch-table thead th {
  color: var(--pb-text-muted);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.ch-swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  margin-right: 0.5rem;
  border-radius: 50%;
}

.ch-back {
  align-self: flex-start;
  font-weight: 700;
}

@media (max-width: 575.98px) {
  .ch-wallet-text .ch-label,
  .ch-coins {
    max-width: calc(100% - 90px);
  }
}

@media (min-width: 768px) {
  .ch-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .ch-wallet {
    grid-column: 1 / -1;
  }
}

@media (min-width: 992px) {
  .ch-wallet-art {
    --booster-w: clamp(100px, 10vw, 130px);
    position: relative;
    top: auto;
    right: auto;
    flex: 0 0 35%;
    height: auto;
  }
}
</style>
