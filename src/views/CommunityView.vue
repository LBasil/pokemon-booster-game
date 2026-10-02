<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { routeMode } from '@/router/modes'
import { LEADERBOARDS, fetchFeed, fetchLeaderboard, fetchMyRank, subscribeToFeed } from '@/api/social'
import { useProfileStore } from '@/stores/profile'
import { useSetsStore } from '@/stores/sets'
import { groupFeed } from '@/utils/feed'
import { timeAgo } from '@/utils/time'
import AppHeader from '@/components/AppHeader.vue'

// Live feed of hits (Supabase Realtime) + luck-based leaderboards.
const { t, locale } = useI18n()
const route = useRoute()
const profileStore = useProfileStore()
const setsStore = useSetsStore()

// ---------- Live feed ----------

// Challenge | Unlimited switch (like the leaderboards), opening on the mode
// the player came from. Each mode's list is fetched once, then kept live.
const MODES = ['challenge', 'unlimited']
const feedMode = ref(routeMode(route))
const feeds = ref({ challenge: [], unlimited: [] })
const feedStates = ref({ challenge: 'idle', unlimited: 'idle' }) // idle | loading | ready | error
const feed = computed(() => feeds.value[feedMode.value])
const feedState = computed(() => (feedStates.value[feedMode.value] === 'idle' ? 'loading' : feedStates.value[feedMode.value]))
const freshIds = ref(new Set()) // just arrived: highlighted briefly

// One busy player's pulls in a row fold into one entry (the rarest shown),
// and the feed shows a few entries at a time: it ran ~9,000px on a phone
const FEED_STEP = 8
const feedShown = ref(FEED_STEP)
const feedGroups = computed(() => groupFeed(feed.value))
const visibleGroups = computed(() => feedGroups.value.slice(0, feedShown.value))
const openGroups = ref(new Set())
function toggleGroup(key) {
  const next = new Set(openGroups.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  openGroups.value = next
}
watch(feedMode, () => (feedShown.value = FEED_STEP))
const now = ref(new Date())
let unsubscribe = null
let clock = null

async function loadFeed(mode) {
  if (feedStates.value[mode] === 'loading' || feedStates.value[mode] === 'ready') return
  feedStates.value[mode] = 'loading'
  try {
    const pulls = await fetchFeed(30, mode)
    // Realtime pulls that came in meanwhile stay on top
    const seen = new Set(feeds.value[mode].map((item) => item.id))
    feeds.value[mode] = [...feeds.value[mode], ...pulls.filter((item) => !seen.has(item.id))].slice(0, 50)
    feedStates.value[mode] = 'ready'
  } catch {
    feedStates.value[mode] = 'error'
  }
}
watch(feedMode, loadFeed)

onMounted(() => {
  profileStore.load()
  setsStore.load()
  loadFeed(feedMode.value)
  unsubscribe = subscribeToFeed((pull) => {
    const mode = pull.mode === 'challenge' ? 'challenge' : 'unlimited'
    if (feeds.value[mode].some((item) => item.id === pull.id)) return
    feeds.value[mode] = [pull, ...feeds.value[mode]].slice(0, 50)
    freshIds.value = new Set(freshIds.value).add(pull.id)
    setTimeout(() => {
      const next = new Set(freshIds.value)
      next.delete(pull.id)
      freshIds.value = next
    }, 4000)
  })
  clock = setInterval(() => (now.value = new Date()), 30_000) // keeps "3 min ago" fresh
})

onBeforeUnmount(() => {
  unsubscribe?.()
  clearInterval(clock)
})

// ---------- Leaderboards ----------

// Challenge | Unlimited switch, then that mode's boards. Opens on the mode
// the player came from; each mode remembers its last board.
const boardMode = ref(routeMode(route))
const lastBoard = { challenge: LEADERBOARDS.challenge[0], unlimited: LEADERBOARDS.unlimited[0] }
const board = ref(lastBoard[boardMode.value])
function pickBoardMode(next) {
  if (next === boardMode.value) return
  lastBoard[boardMode.value] = board.value
  boardMode.value = next
  board.value = lastBoard[next]
}
const rows = ref([])
const boardState = ref('loading')
// My place on it (migration 0022), shown under the top 20 when I'm not in it
const myRank = ref(null)

async function loadBoard(kind) {
  boardState.value = 'loading'
  try {
    const [data, mine] = await Promise.all([fetchLeaderboard(kind, 20), fetchMyRank(kind)])
    if (kind !== board.value) return // switched again meanwhile: a late answer
    rows.value = data
    myRank.value = mine
    boardState.value = 'ready'
  } catch {
    if (kind === board.value) boardState.value = 'error'
  }
}
watch(board, loadBoard, { immediate: true })

const myName = computed(() => profileStore.profile?.username?.toLowerCase() ?? null)
const meShown = computed(() => rows.value.some((row) => row.username.toLowerCase() === myName.value))
// Ranked further down: my own row under the list
const meRow = computed(() =>
  myRank.value?.rank && !meShown.value ? { ...myRank.value, username: profileStore.profile?.username ?? '' } : null,
)
// Not on the board: why, and what gets me on it
const meNote = computed(() => {
  const mine = myRank.value
  if (!mine || meShown.value) return ''
  if (mine.public === false) return t('community.me.private')
  if (mine.rank) return ''
  if (board.value === 'hit_rate') return t('community.me.hit_rate', { packs: Math.min(mine.packs ?? 0, 20) })
  return t(`community.me.${board.value}`)
})
const formatNumber = (value, digits = 0) =>
  Number(value).toLocaleString(locale.value, { maximumFractionDigits: digits, minimumFractionDigits: digits })
const formatEuros = (value) =>
  new Intl.NumberFormat(locale.value, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value)

function scoreLabel(row) {
  if (board.value === 'hit_rate') return t('community.hitRateScore', { rate: formatNumber(row.score, 1), packs: formatNumber(row.packs) })
  if (board.value === 'best_pull' || board.value === 'challenge_value') return formatEuros(row.score)
  if (board.value === 'challenge_unique') return t('community.uniqueScore', { count: formatNumber(row.score) }, Number(row.score))
  return t('community.completeScore', { count: formatNumber(row.score) }, Number(row.score))
}
</script>

<template>
  <div class="pb-page">
    <AppHeader />

    <main class="container community">
      <header>
        <h1 class="community-title">{{ t('community.title') }}</h1>
        <p class="pb-muted">
          <template v-if="profileStore.profile?.is_public === false">{{ t('community.privateNote') }}</template>
          <template v-else>{{ t('community.publicNote') }}</template>
          <RouterLink :to="{ name: 'profile' }" class="ms-1">{{ t('community.manage') }}</RouterLink>
        </p>
      </header>

      <div class="community-layout">
        <!-- ============ Live feed ============ -->
        <section class="panel feed-panel" aria-labelledby="feed-title">
          <div class="board-head">
            <h2 id="feed-title" class="pb-section-title">{{ t('community.feedTitle') }}</h2>
            <div class="mode-tabs feed-modes" role="tablist" :aria-label="t('community.feedModes')">
              <button
                v-for="item in MODES"
                :key="item"
                type="button"
                role="tab"
                :aria-selected="feedMode === item"
                :class="{ active: feedMode === item }"
                @click="feedMode = item"
              >
                {{ t(item === 'challenge' ? 'nav.modeChallenge' : 'nav.modeUnlimited') }}
              </button>
            </div>
          </div>

          <div v-if="feedState === 'error'" class="alert alert-danger mt-3" role="alert">{{ t('community.feedError') }}</div>
          <div v-else-if="feedState === 'loading'" class="feed-list mt-3">
            <div v-for="n in 5" :key="n" class="pb-skeleton" style="height: 64px"></div>
          </div>
          <p v-else-if="!feed.length" class="community-empty">{{ t('community.feedEmpty') }}</p>

          <template v-else>
          <ul class="feed-list" role="list" aria-live="polite">
            <li
              v-for="group in visibleGroups"
              :key="group.key"
              class="feed-item"
              :class="{ fresh: group.pulls.some((pull) => freshIds.has(pull.id)) }"
            >
              <div class="feed-row">
                <img class="feed-card" :src="group.best.image_small" alt="" loading="lazy" />
                <div class="feed-text">
                  <p class="feed-line">
                    <RouterLink :to="{ name: 'public-profile', params: { username: group.best.username } }" class="feed-user">
                      {{ group.best.username }}
                    </RouterLink>
                    {{ t('community.pulled') }}
                    <strong>{{ group.best.card_name }}</strong>
                    <span v-if="group.pulls.length > 1">{{ ' ' + t('community.andMore', { count: group.pulls.length - 1 }, group.pulls.length - 1) }}</span>
                  </p>
                  <p class="feed-meta">
                    <span class="feed-chip" :data-bucket="group.best.bucket">{{ t(`boosters.bucket.${group.best.bucket}`) }}</span>
                    <span class="feed-mode" :class="{ challenge: group.best.mode === 'challenge' }">{{ group.best.mode === 'challenge' ? t('nav.modeChallenge') : t('nav.modeUnlimited') }}</span>
                    <span>{{ setsStore.byId[group.best.set_id]?.name ?? group.best.set_id }}</span>
                    <span aria-hidden="true">·</span>
                    <time :datetime="group.pulls[0].pulled_at">{{ timeAgo(group.pulls[0].pulled_at, locale, now) }}</time>
                  </p>
                  <button
                    v-if="group.pulls.length > 1"
                    type="button"
                    class="feed-expand"
                    :aria-expanded="openGroups.has(group.key)"
                    @click="toggleGroup(group.key)"
                  >
                    {{ openGroups.has(group.key) ? t('community.hidePulls') : t('community.showPulls', { count: group.pulls.length }) }}
                  </button>
                </div>
              </div>
              <ul v-if="openGroups.has(group.key)" class="feed-sub" role="list">
                <li v-for="pull in group.pulls" :key="pull.id">
                  <img class="feed-sub-card" :src="pull.image_small" alt="" loading="lazy" />
                  <span class="feed-sub-name">{{ pull.card_name }}</span>
                  <span class="feed-chip" :data-bucket="pull.bucket">{{ t(`boosters.bucket.${pull.bucket}`) }}</span>
                </li>
              </ul>
            </li>
          </ul>
          <button v-if="feedGroups.length > feedShown" type="button" class="btn btn-outline-secondary btn-sm feed-more" @click="feedShown += FEED_STEP">
            {{ t('community.feedMore') }}
          </button>
          </template>
        </section>

        <!-- ============ Leaderboards ============ -->
        <section class="panel" aria-labelledby="board-title">
          <div class="board-head">
            <h2 id="board-title" class="pb-section-title">{{ t('community.boardsTitle') }}</h2>
            <!-- Separate collections: each mode has its own boards -->
            <div class="mode-tabs board-modes" role="tablist" :aria-label="t('nav.modeSwitch')">
              <button
                v-for="item in MODES"
                :key="item"
                type="button"
                role="tab"
                :aria-selected="boardMode === item"
                :class="{ active: boardMode === item }"
                @click="pickBoardMode(item)"
              >
                {{ t(item === 'challenge' ? 'nav.modeChallenge' : 'nav.modeUnlimited') }}
              </button>
            </div>
          </div>
          <div class="board-tabs" role="tablist" :aria-label="t('community.boardsTitle')">
            <button
              v-for="kind in LEADERBOARDS[boardMode]"
              :key="kind"
              type="button"
              role="tab"
              :aria-selected="board === kind"
              :class="{ active: board === kind }"
              @click="board = kind"
            >
              {{ t(`community.boards.${kind}`) }}
            </button>
          </div>
          <p class="board-desc">{{ t(`community.boardDesc.${board}`) }}</p>

          <div v-if="boardState === 'error'" class="alert alert-danger" role="alert">{{ t('community.boardError') }}</div>
          <div v-else-if="boardState === 'loading'" class="board-list">
            <div v-for="n in 6" :key="n" class="pb-skeleton" style="height: 52px"></div>
          </div>
          <p v-else-if="!rows.length" class="community-empty">{{ t('community.boardEmpty') }}</p>

          <ol v-if="boardState === 'ready' && (rows.length || meRow)" class="board-list">
            <li
              v-for="row in rows"
              :key="`${board}-${row.username}`"
              class="board-row"
              :class="{ mine: row.username.toLowerCase() === myName, podium: row.rank <= 3 }"
            >
              <span class="board-rank" :data-rank="row.rank">{{ row.rank }}</span>
              <RouterLink :to="{ name: 'public-profile', params: { username: row.username } }" class="board-user">
                {{ row.username }}
              </RouterLink>
              <img v-if="row.image_small" class="board-card" :src="row.image_small" :alt="row.card_name" loading="lazy" />
              <span class="board-score">{{ scoreLabel(row) }}</span>
            </li>
            <li v-if="meRow" class="board-row mine board-me">
              <span class="board-rank" :data-rank="meRow.rank">{{ meRow.rank }}</span>
              <span class="board-user">{{ t('community.me.you') }}</span>
              <img v-if="meRow.image_small" class="board-card" :src="meRow.image_small" :alt="meRow.card_name" loading="lazy" />
              <span class="board-score">{{ scoreLabel(meRow) }}</span>
            </li>
          </ol>
          <p v-if="boardState === 'ready' && meNote" class="board-me-note">
            {{ meNote }}
            <RouterLink v-if="myRank.public === false" :to="{ name: 'profile' }">{{ t('community.manage') }}</RouterLink>
          </p>
        </section>
      </div>
    </main>
  </div>
</template>

<style scoped>
.community {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  padding-top: 1rem;
}

.community-title {
  margin: 0 0 0.5rem;
  font-size: clamp(1.8rem, 5vw, 2.6rem);
  font-weight: 800;
}

/* minmax(0, 1fr): the leaderboard tabs (nowrap) must scroll, not widen the page */
.community-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1.5rem;
  align-items: start;
}

.panel {
  min-width: 0;
  padding: 1.5rem;
  border-radius: var(--pb-radius-lg);
  border: 1px solid var(--pb-border);
  background: var(--pb-surface);
}

@media (max-width: 575.98px) {
  .panel {
    padding: 1rem;
  }
}

.community-empty {
  margin: 1rem 0 0;
  color: var(--pb-text-muted);
}

/* ---------- Feed ---------- */

.feed-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 1rem 0 0;
  padding: 0;
  list-style: none;
}

.feed-item {
  padding: 0.55rem;
  border-radius: var(--pb-radius-md);
  background: var(--pb-input-bg);
  border: 1px solid var(--pb-border);
  animation: feed-in 0.5s var(--pb-ease-out) both;
}

/* A pull that just came in over Realtime */
.feed-item.fresh {
  border-color: transparent;
  background:
    linear-gradient(var(--pb-bg-elevated), var(--pb-bg-elevated)) padding-box,
    var(--pb-holo) border-box;
}

@keyframes feed-in {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
}

.feed-row {
  display: flex;
  align-items: center;
  gap: 0.8rem;
}

.feed-expand {
  margin-top: 0.25rem;
  padding: 0;
  border: none;
  background: none;
  color: var(--bs-link-color);
  font-size: 0.8rem;
  font-weight: 700;
}

.feed-sub {
  display: grid;
  gap: 0.35rem;
  margin: 0.6rem 0 0;
  padding: 0.5rem 0 0;
  border-top: 1px solid var(--pb-border);
  list-style: none;
}

.feed-sub li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  font-size: 0.85rem;
}

.feed-sub-card {
  width: 24px;
  flex-shrink: 0;
  aspect-ratio: 63 / 88;
  object-fit: cover;
  border-radius: 2px;
}

.feed-sub-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.feed-more {
  margin-top: 0.75rem;
}

.feed-card {
  width: 44px;
  flex-shrink: 0;
  aspect-ratio: 63 / 88;
  object-fit: cover;
  border-radius: 3px;
  box-shadow: var(--pb-shadow-card);
}

.feed-text {
  min-width: 0;
}

.feed-line {
  margin: 0;
  overflow-wrap: anywhere;
}

.feed-user {
  font-weight: 800;
}

.feed-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  margin: 0.2rem 0 0;
  font-size: 0.8rem;
  color: var(--pb-text-muted);
}

.feed-chip {
  padding: 0.05rem 0.5rem;
  border-radius: 999px;
  font-size: 0.65rem;
  font-weight: 800;
  text-transform: uppercase;
  color: #0a0d1a;
  background: var(--pb-holo);
}

/* Pulled in the challenge mode */
.feed-mode {
  padding: 0.05rem 0.5rem;
  border-radius: 999px;
  border: 1px solid var(--pb-border-strong);
  color: var(--pb-text-muted);
  font-size: 0.65rem;
  font-weight: 800;
  text-transform: uppercase;
}

.feed-mode.challenge {
  color: var(--pb-coin);
}

/* ---------- Leaderboards ---------- */

.board-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.mode-tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: 999px;
  border: 1px solid var(--pb-border-strong);
  background: var(--pb-input-bg);
}

.mode-tabs button {
  padding: 0.35rem 0.9rem;
  border: none;
  border-radius: 999px;
  background: none;
  color: var(--pb-text-muted);
  font-weight: 700;
  font-size: 0.85rem;
  white-space: nowrap;
}

.mode-tabs button.active {
  background: var(--pb-text);
  color: var(--pb-bg);
}

.board-tabs {
  display: flex;
  gap: 4px;
  margin-top: 1rem;
  padding: 4px;
  border-radius: var(--pb-radius-md);
  border: 1px solid var(--pb-border-strong);
  background: var(--pb-input-bg);
  overflow-x: auto;
  scrollbar-width: none;
}

.board-tabs button {
  flex: 1 0 auto;
  padding: 0.5rem 0.8rem;
  border: none;
  border-radius: calc(var(--pb-radius-md) - 4px);
  background: none;
  color: var(--pb-text-muted);
  font-weight: 700;
  font-size: 0.85rem;
  white-space: nowrap;
}

.board-tabs button.active {
  background: var(--pb-text);
  color: var(--pb-bg);
}

.board-desc {
  margin: 0.75rem 0 1rem;
  font-size: 0.85rem;
  color: var(--pb-text-muted);
}

/* Rows share their columns (subgrid): cards and scores line up */
.board-list {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  gap: 0.4rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.board-list > .pb-skeleton {
  grid-column: 1 / -1;
}

.board-row {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: subgrid;
  align-items: center;
  column-gap: 0.75rem;
  padding: 0.55rem 0.75rem;
  border-radius: var(--pb-radius-md);
  border: 1px solid var(--pb-border);
  background: var(--pb-input-bg);
}

.board-row.mine {
  border-color: var(--pb-ring);
  background: color-mix(in srgb, var(--pb-ring) 12%, var(--pb-input-bg));
}

/* Me, further down the board: set apart from the top 20 */
.board-me {
  margin-top: 0.6rem;
}

.board-me-note {
  margin: 0.75rem 0 0;
  padding: 0.6rem 0.8rem;
  border-radius: var(--pb-radius-md);
  border: 1px dashed var(--pb-border-strong);
  color: var(--pb-text-muted);
  font-size: 0.9rem;
}

.board-rank {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--pb-selected);
  font-family: var(--pb-font-display);
  font-weight: 800;
  font-size: 0.85rem;
}

.podium .board-rank {
  color: #0a0d1a;
  background: var(--pb-holo);
}

.board-user {
  grid-column: 2;
  min-width: 0;
  font-weight: 800;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.board-card {
  grid-column: 3;
  justify-self: end;
  width: 30px;
  aspect-ratio: 63 / 88;
  object-fit: cover;
  border-radius: 2px;
}

.board-score {
  grid-column: 4;
  font-weight: 700;
  font-size: 0.85rem;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* A mouse can't swipe the tabs sideways: wrap them instead of hiding the last ones */
@media (hover: hover) and (pointer: fine) {
  .board-tabs {
    flex-wrap: wrap;
  }
}

@media (min-width: 992px) {
  .community-layout {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }

  /* Side by side, the feed (30+ pulls) takes the leaderboard's height and
     scrolls inside, instead of stretching the page next to an empty column.
     contain: size = its content doesn't size the grid row. */
  .feed-panel {
    align-self: stretch;
    contain: size;
    min-height: 36rem;
    display: flex;
    flex-direction: column;
  }

  .feed-panel .feed-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding-right: 0.25rem;
  }
}
</style>
