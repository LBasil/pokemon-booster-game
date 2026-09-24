<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { LEADERBOARDS, fetchFeed, fetchLeaderboard, subscribeToFeed } from '@/api/social'
import { useProfileStore } from '@/stores/profile'
import { useSetsStore } from '@/stores/sets'
import { timeAgo } from '@/utils/time'
import AppHeader from '@/components/AppHeader.vue'

// Live feed of hits (Supabase Realtime) + luck-based leaderboards.
const { t, locale } = useI18n()
const profileStore = useProfileStore()
const setsStore = useSetsStore()

// ---------- Live feed ----------

const feed = ref([])
const feedState = ref('loading') // loading | ready | error
const freshIds = ref(new Set()) // just arrived: highlighted briefly
const now = ref(new Date())
let unsubscribe = null
let clock = null

onMounted(async () => {
  profileStore.load()
  setsStore.load()
  try {
    feed.value = await fetchFeed(30)
    feedState.value = 'ready'
  } catch {
    feedState.value = 'error'
  }
  unsubscribe = subscribeToFeed((pull) => {
    if (feed.value.some((item) => item.id === pull.id)) return
    feed.value = [pull, ...feed.value].slice(0, 50)
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

const board = ref(LEADERBOARDS[0])
const rows = ref([])
const boardState = ref('loading')

async function loadBoard(kind) {
  boardState.value = 'loading'
  try {
    rows.value = await fetchLeaderboard(kind, 20)
    boardState.value = 'ready'
  } catch {
    boardState.value = 'error'
  }
}
watch(board, loadBoard, { immediate: true })

const myName = computed(() => profileStore.profile?.username?.toLowerCase() ?? null)
const formatNumber = (value, digits = 0) =>
  Number(value).toLocaleString(locale.value, { maximumFractionDigits: digits, minimumFractionDigits: digits })
const formatEuros = (value) =>
  new Intl.NumberFormat(locale.value, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value)

function scoreLabel(row) {
  if (board.value === 'hit_rate') return t('community.hitRateScore', { rate: formatNumber(row.score, 1), packs: formatNumber(row.packs) })
  if (board.value === 'best_pull') return formatEuros(row.score)
  return t('community.completeScore', { count: formatNumber(row.score) }, Number(row.score))
}
</script>

<template>
  <div class="pb-page">
    <AppHeader />

    <main class="container community">
      <header>
        <span class="pb-eyebrow">
          <span class="live-dot" aria-hidden="true"></span>
          {{ t('community.eyebrow') }}
        </span>
        <h1 class="community-title">{{ t('community.title') }}</h1>
        <p class="pb-muted">
          <template v-if="profileStore.profile?.is_public === false">{{ t('community.privateNote') }}</template>
          <template v-else>{{ t('community.publicNote') }}</template>
          <RouterLink :to="{ name: 'profile' }" class="ms-1">{{ t('community.manage') }}</RouterLink>
        </p>
      </header>

      <div class="community-layout">
        <!-- ============ Live feed ============ -->
        <section class="panel" aria-labelledby="feed-title">
          <h2 id="feed-title" class="pb-section-title">{{ t('community.feedTitle') }}</h2>

          <div v-if="feedState === 'error'" class="alert alert-danger mt-3" role="alert">{{ t('community.feedError') }}</div>
          <div v-else-if="feedState === 'loading'" class="feed-list mt-3">
            <div v-for="n in 5" :key="n" class="pb-skeleton" style="height: 64px"></div>
          </div>
          <p v-else-if="!feed.length" class="community-empty">{{ t('community.feedEmpty') }}</p>

          <ul v-else class="feed-list" role="list" aria-live="polite">
            <li v-for="pull in feed" :key="pull.id" class="feed-item" :class="{ fresh: freshIds.has(pull.id) }">
              <img class="feed-card" :src="pull.image_small" alt="" loading="lazy" />
              <div class="feed-text">
                <p class="feed-line">
                  <RouterLink :to="{ name: 'public-profile', params: { username: pull.username } }" class="feed-user">
                    {{ pull.username }}
                  </RouterLink>
                  {{ t('community.pulled') }}
                  <strong>{{ pull.card_name }}</strong>
                </p>
                <p class="feed-meta">
                  <span class="feed-chip" :data-bucket="pull.bucket">{{ t(`boosters.bucket.${pull.bucket}`) }}</span>
                  <span>{{ setsStore.byId[pull.set_id]?.name ?? pull.set_id }}</span>
                  <span aria-hidden="true">·</span>
                  <time :datetime="pull.pulled_at">{{ timeAgo(pull.pulled_at, locale, now) }}</time>
                </p>
              </div>
            </li>
          </ul>
        </section>

        <!-- ============ Leaderboards ============ -->
        <section class="panel" aria-labelledby="board-title">
          <h2 id="board-title" class="pb-section-title">{{ t('community.boardsTitle') }}</h2>
          <div class="board-tabs" role="tablist">
            <button
              v-for="kind in LEADERBOARDS"
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

          <ol v-else class="board-list">
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
          </ol>
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
  margin: 1rem 0 0.5rem;
  font-size: clamp(1.8rem, 5vw, 2.6rem);
  font-weight: 800;
}

.live-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--pb-accent);
  animation: live-pulse 2.4s ease-out infinite;
}

@keyframes live-pulse {
  0% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--pb-accent) 60%, transparent);
  }
  100% {
    box-shadow: 0 0 0 10px transparent;
  }
}

.community-layout {
  display: grid;
  gap: 1.5rem;
  align-items: start;
}

.panel {
  padding: 1.5rem;
  border-radius: var(--pb-radius-lg);
  border: 1px solid var(--pb-border);
  background: var(--pb-surface);
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
  display: flex;
  align-items: center;
  gap: 0.8rem;
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

/* ---------- Leaderboards ---------- */

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

.board-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.board-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.55rem 0.75rem;
  border-radius: var(--pb-radius-md);
  border: 1px solid var(--pb-border);
  background: var(--pb-input-bg);
}

.board-row.mine {
  border-color: var(--pb-ring);
  background: color-mix(in srgb, var(--pb-ring) 12%, var(--pb-input-bg));
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
  flex: 1;
  min-width: 0;
  font-weight: 800;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.board-card {
  width: 30px;
  aspect-ratio: 63 / 88;
  object-fit: cover;
  border-radius: 2px;
}

.board-score {
  flex-shrink: 0;
  font-weight: 700;
  font-size: 0.85rem;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

@media (min-width: 992px) {
  .community-layout {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
}
</style>
