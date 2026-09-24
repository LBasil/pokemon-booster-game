<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useCollectionStore } from '@/stores/collection'
import { useSetsStore } from '@/stores/sets'
import { collectionStats } from '@/utils/collection'
import { USERNAME_MAX, achievements, boostersOpened, rankFor, rarityBreakdown, validateUsername } from '@/utils/profile'
import { BUCKETS, bestPull, rarityLabelKey, rarityTier } from '@/utils/rarity'
import AppHeader from '@/components/AppHeader.vue'
import HoloCard from '@/components/HoloCard.vue'
import ShowcasePicker from '@/components/ShowcasePicker.vue'

const { t, locale } = useI18n()
const router = useRouter()
const auth = useAuthStore()
const collectionStore = useCollectionStore()
const setsStore = useSetsStore()

onMounted(() => {
  collectionStore.load()
  setsStore.load()
})

const entries = computed(() => collectionStore.entries)
const firstLoad = computed(() => collectionStore.loading && !collectionStore.loaded)
const metadata = computed(() => auth.user?.user_metadata ?? {})

const formatNumber = (value) => value.toLocaleString(locale.value)
const formatEuros = (value) =>
  new Intl.NumberFormat(locale.value, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value)

const memberSince = computed(() =>
  auth.user?.created_at
    ? new Date(auth.user.created_at).toLocaleDateString(locale.value, { month: 'long', year: 'numeric' })
    : '',
)

// ---------- Stats & rank ----------

const stats = computed(() => collectionStats(entries.value))
const boosters = computed(() => boostersOpened(stats.value.totalCards))
const rank = computed(() => rankFor(boosters.value))

// ---------- Username ----------

const editingName = ref(false)
const nameDraft = ref('')
const nameError = ref('')
const savingName = ref(false)
const nameInput = ref(null)

function startEditName() {
  nameDraft.value = metadata.value.username ?? ''
  nameError.value = ''
  editingName.value = true
  nextTick(() => nameInput.value?.focus())
}

async function saveName() {
  const problem = validateUsername(nameDraft.value)
  if (problem) {
    nameError.value = t(`profile.username.${problem}`)
    return
  }
  savingName.value = true
  try {
    await auth.updateProfile({ username: nameDraft.value.trim() })
    editingName.value = false
  } catch {
    nameError.value = t('profile.saveError')
  } finally {
    savingName.value = false
  }
}

// ---------- Showcase card ----------

const pickerOpen = ref(false)
const showcaseError = ref('')
const chosenEntry = computed(() =>
  metadata.value.showcase_card_id
    ? (entries.value.find((entry) => entry.card_id === metadata.value.showcase_card_id) ?? null)
    : null,
)
// Falls back to the best pull when nothing is chosen (or the card is gone)
const showcaseCard = computed(() => chosenEntry.value?.cards ?? bestPull(entries.value.map((entry) => entry.cards)))

async function setShowcase(cardId) {
  showcaseError.value = ''
  try {
    await auth.updateProfile({ showcase_card_id: cardId })
  } catch {
    showcaseError.value = t('profile.saveError')
  }
}

// ---------- Rarity breakdown ----------

const breakdown = computed(() => {
  const counts = rarityBreakdown(entries.value)
  const total = entries.value.length || 1
  return BUCKETS.map((bucket) => ({ bucket, count: counts[bucket], percent: (counts[bucket] / total) * 100 }))
})

// ---------- Achievements ----------

const ACHIEVEMENT_ICONS = {
  firstBooster: 'M7 3h10l1 3-1 15H7L6 6zM6 6h12',
  tenBoosters: 'M5 5h9l1 3-1 13H5L4 8zM4 8h11M17 5l3 1-2 14',
  hundredBoosters: 'M12 2l2.5 5 5.5.8-4 3.9.9 5.5L12 14.6 7.1 17.2 8 11.7 4 7.8l5.5-.8z',
  firstHolo: 'M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2z',
  firstUltra: 'M12 2l2.5 5 5.5.8-4 3.9.9 5.5L12 14.6 7.1 17.2 8 11.7 4 7.8l5.5-.8zM5 21h14',
  firstSecret: 'M6 3h12l3 6-9 12L3 9zM3 9h18M9 3l3 18 3-18',
  hundredUnique: 'M8 3h11v15H8zM5 6v15h11',
  thousandCards: 'M4 7h16M4 12h16M4 17h16',
  tenSets: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  halfSet: 'M12 3a9 9 0 1 0 0 18V3z',
  completeSet: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4',
  vintage: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  bigValue: 'M12 3v18M17 7H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6',
}

const badges = computed(() => achievements(entries.value, setsStore.sets))
const unlockedCount = computed(() => badges.value.filter((badge) => badge.unlocked).length)

// ---------- Account ----------

async function logout() {
  await auth.signOut()
  router.push({ name: 'home' })
}
</script>

<template>
  <div class="pb-page">
    <AppHeader />

    <main class="container profile">
      <div class="profile-layout">
        <!-- ============ Trainer card + showcase ============ -->
        <aside class="profile-side">
          <section class="trainer-card" :aria-label="t('profile.trainerCard')">
            <div class="trainer-top">
              <div class="trainer-avatar" aria-hidden="true">{{ auth.displayName.charAt(0).toUpperCase() || '?' }}</div>
              <div class="trainer-id">
                <span class="trainer-rank" :data-rank="rank.rank.id">
                  {{ t('profile.level', { level: rank.level }) }} · {{ t(`profile.ranks.${rank.rank.id}`) }}
                </span>

                <form v-if="editingName" class="name-form" @submit.prevent="saveName" @keydown.esc="editingName = false">
                  <label class="visually-hidden" for="username-input">{{ t('profile.username.label') }}</label>
                  <input
                    id="username-input"
                    ref="nameInput"
                    v-model="nameDraft"
                    class="form-control"
                    :maxlength="USERNAME_MAX + 10"
                    autocomplete="nickname"
                  />
                  <div class="name-actions">
                    <button type="submit" class="btn btn-primary btn-sm" :disabled="savingName">
                      <span v-if="savingName" class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>
                      {{ t('profile.save') }}
                    </button>
                    <button type="button" class="btn btn-outline-secondary btn-sm" @click="editingName = false">
                      {{ t('common.cancel') }}
                    </button>
                  </div>
                  <p v-if="nameError" class="name-error" role="alert">{{ nameError }}</p>
                </form>

                <div v-else class="trainer-name-row">
                  <h1 class="trainer-name">{{ auth.displayName }}</h1>
                  <button type="button" class="name-edit" :aria-label="t('profile.username.edit')" :title="t('profile.username.edit')" @click="startEditName">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" /></svg>
                  </button>
                </div>
                <p v-if="!metadata.username && !editingName" class="trainer-hint">{{ t('profile.username.hint') }}</p>
              </div>
            </div>

            <div class="rank-progress">
              <p class="rank-progress-count">{{ t('profile.boostersOpened', { count: formatNumber(boosters) }, boosters) }}</p>
              <div class="bar" role="progressbar" :aria-label="t('profile.rankProgress')" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="Math.round(rank.progress * 100)">
                <span :style="{ width: `${Math.max(rank.progress * 100, 2)}%` }"></span>
              </div>
              <p class="rank-progress-next">
                <template v-if="rank.next">
                  {{ t('profile.nextRank', { rank: t(`profile.ranks.${rank.next.id}`), count: formatNumber(rank.next.min - boosters) }, rank.next.min - boosters) }}
                </template>
                <template v-else>{{ t('profile.maxRank') }}</template>
              </p>
            </div>

            <dl class="trainer-facts">
              <div>
                <dt>{{ t('profile.email') }}</dt>
                <dd>{{ auth.user?.email }}</dd>
              </div>
              <div v-if="memberSince">
                <dt>{{ t('profile.memberSince') }}</dt>
                <dd>{{ memberSince }}</dd>
              </div>
            </dl>
          </section>

          <section class="showcase" :aria-label="t('profile.showcaseTitle')">
            <div class="section-head">
              <h2 class="pb-section-title">{{ t('profile.showcaseTitle') }}</h2>
              <button v-if="entries.length" type="button" class="btn btn-link section-action" @click="pickerOpen = true">
                {{ t('profile.showcaseChange') }}
              </button>
            </div>
            <template v-if="showcaseCard">
              <div class="showcase-card" :data-tier="rarityTier(showcaseCard)">
                <span class="showcase-glow" aria-hidden="true"></span>
                <HoloCard
                  :src="showcaseCard.image_small || showcaseCard.image_url"
                  :srcset="showcaseCard.image_small && showcaseCard.image_url ? `${showcaseCard.image_small} 245w, ${showcaseCard.image_url} 734w` : null"
                  sizes="280px"
                  :alt="showcaseCard.name"
                  eager
                />
              </div>
              <p class="showcase-caption">
                <strong>{{ showcaseCard.name }}</strong>
                <span v-if="rarityLabelKey(showcaseCard) !== 'common' && rarityLabelKey(showcaseCard) !== 'uncommon'">
                  · {{ t(`boosters.bucket.${rarityLabelKey(showcaseCard)}`) }}
                </span>
                <span class="showcase-mode">{{ chosenEntry ? t('profile.showcaseChosen') : t('profile.showcaseAutoShort') }}</span>
              </p>
            </template>
            <div v-else-if="!firstLoad" class="showcase-empty">
              <p>{{ t('profile.showcaseEmpty') }}</p>
              <RouterLink :to="{ name: 'boosters' }" class="btn btn-primary glow-button">{{ t('game.openCta') }}</RouterLink>
            </div>
            <div v-if="showcaseError" class="alert alert-danger mt-2" role="alert">{{ showcaseError }}</div>
          </section>
        </aside>

        <!-- ============ Stats, rarity, achievements, account ============ -->
        <div class="profile-main">
          <section :aria-label="t('profile.statsTitle')">
            <dl class="stat-grid">
              <div class="stat">
                <dt>{{ t('profile.statBoosters') }}</dt>
                <dd>{{ formatNumber(boosters) }}</dd>
              </div>
              <div class="stat">
                <dt>{{ t('collection.statPulled') }}</dt>
                <dd>{{ formatNumber(stats.totalCards) }}</dd>
              </div>
              <div class="stat">
                <dt>{{ t('collection.statUnique') }}</dt>
                <dd>{{ formatNumber(stats.uniqueCards) }}</dd>
              </div>
              <div class="stat">
                <dt>{{ t('collection.statSets') }}</dt>
                <dd>{{ formatNumber(stats.setsStarted) }}</dd>
              </div>
              <div class="stat">
                <dt>{{ t('collection.statValue') }}</dt>
                <dd>{{ formatEuros(stats.value) }}</dd>
              </div>
            </dl>
          </section>

          <section v-if="entries.length" class="panel">
            <h2 class="pb-section-title">{{ t('profile.rarityTitle') }}</h2>
            <div class="rarity-bar" role="img" :aria-label="breakdown.filter((b) => b.count).map((b) => `${t(`profile.buckets.${b.bucket}`)} ${b.count}`).join(', ')">
              <span
                v-for="item in breakdown.filter((b) => b.count)"
                :key="item.bucket"
                :style="{ width: `${item.percent}%`, background: `var(--pb-bucket-${item.bucket})` }"
              ></span>
            </div>
            <ul class="rarity-legend" role="list">
              <li v-for="item in breakdown" :key="item.bucket" :class="{ empty: !item.count }">
                <span class="legend-dot" :style="{ background: `var(--pb-bucket-${item.bucket})` }" aria-hidden="true"></span>
                <span class="legend-name">{{ t(`profile.buckets.${item.bucket}`) }}</span>
                <span class="legend-count">{{ formatNumber(item.count) }}</span>
              </li>
            </ul>
          </section>

          <section class="panel">
            <div class="section-head">
              <h2 class="pb-section-title">{{ t('profile.achievementsTitle') }}</h2>
              <span class="section-count">{{ unlockedCount }} / {{ badges.length }}</span>
            </div>
            <ul class="achv-grid" role="list">
              <li v-for="badge in badges" :key="badge.id" class="achv" :class="{ unlocked: badge.unlocked }">
                <span class="achv-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path :d="ACHIEVEMENT_ICONS[badge.id]" /></svg>
                </span>
                <span class="achv-body">
                  <span class="achv-title">{{ t(`profile.achievements.${badge.id}.title`) }}</span>
                  <span class="achv-desc">{{ t(`profile.achievements.${badge.id}.desc`) }}</span>
                  <span v-if="!badge.unlocked && badge.target > 1" class="achv-progress">
                    <span class="bar bar-sm" aria-hidden="true"><span :style="{ width: `${(badge.current / badge.target) * 100}%` }"></span></span>
                    <span class="achv-progress-text">{{ formatNumber(badge.current) }} / {{ formatNumber(badge.target) }}</span>
                  </span>
                </span>
                <span class="visually-hidden">{{ badge.unlocked ? t('profile.unlocked') : t('profile.locked') }}</span>
              </li>
            </ul>
          </section>

          <section class="panel account">
            <div>
              <h2 class="pb-section-title">{{ t('profile.accountTitle') }}</h2>
              <p class="pb-muted mb-0">{{ t('profile.accountDesc') }}</p>
            </div>
            <button type="button" class="btn btn-outline-secondary" @click="logout">{{ t('common.logout') }}</button>
          </section>
        </div>
      </div>
    </main>

    <ShowcasePicker
      :open="pickerOpen"
      :entries="entries"
      :selected-id="metadata.showcase_card_id ?? null"
      @select="setShowcase"
      @close="pickerOpen = false"
    />
  </div>
</template>

<style scoped>
.profile {
  padding-top: 1rem;
}

.profile-layout {
  display: grid;
  gap: 1.5rem;
}

.profile-side,
.profile-main {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  min-width: 0;
}

.profile-side {
  animation: pb-rise 0.6s var(--pb-ease-out) both;
}

.profile-main {
  animation: pb-rise 0.6s 0.1s var(--pb-ease-out) both;
}

.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.section-action {
  padding: 0;
  font-weight: 700;
}

.section-count {
  font-weight: 700;
  color: var(--pb-text-muted);
}

.panel {
  padding: 1.5rem;
  border-radius: var(--pb-radius-lg);
  border: 1px solid var(--pb-border);
  background: var(--pb-surface);
}

.panel > .pb-section-title {
  margin-bottom: 1rem;
}

/* Shared progress bar */
.bar {
  display: block;
  height: 10px;
  border-radius: 999px;
  background: var(--pb-input-bg);
  border: 1px solid var(--pb-border);
  overflow: hidden;
}

.bar > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--pb-holo);
  transition: width 0.8s var(--pb-ease-out);
}

.bar-sm {
  height: 6px;
  flex: 1;
}

/* ---------- Trainer card ---------- */

.trainer-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 1.5rem;
  border-radius: var(--pb-radius-lg);
  border: 1px solid var(--pb-border);
  background:
    radial-gradient(120% 90% at 100% 0%, color-mix(in srgb, #a78bfa 20%, transparent), transparent 60%),
    var(--pb-bg-elevated);
  box-shadow: var(--pb-shadow-card);
  overflow: hidden;
}

.trainer-card::before {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  height: 3px;
  background: var(--pb-holo);
}

.trainer-top {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
}

.trainer-avatar {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 72px;
  height: 72px;
  border-radius: 50%;
  font-family: var(--pb-font-display);
  font-size: 1.8rem;
  font-weight: 800;
  background:
    linear-gradient(var(--pb-bg-elevated), var(--pb-bg-elevated)) padding-box,
    var(--pb-holo) border-box;
  border: 4px solid transparent;
}

.trainer-id {
  flex: 1;
  min-width: 0;
}

.trainer-rank {
  display: inline-block;
  padding: 0.2rem 0.65rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--pb-accent) 18%, transparent);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.trainer-rank[data-rank='legend'],
.trainer-rank[data-rank='master'] {
  color: #0a0d1a;
  background: var(--pb-holo);
}

.trainer-name-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.trainer-name {
  margin: 0;
  font-size: clamp(1.5rem, 5vw, 2rem);
  font-weight: 800;
  overflow-wrap: anywhere;
}

.name-edit {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  border: 1px solid var(--pb-border-strong);
  background: none;
  color: var(--pb-text-muted);
}

.name-edit:hover {
  color: var(--pb-text);
}

.name-edit svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.trainer-hint {
  margin: 0.25rem 0 0;
  font-size: 0.8rem;
  color: var(--pb-text-muted);
}

.name-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.name-actions {
  display: flex;
  gap: 0.5rem;
}

.name-actions .btn {
  --bs-btn-padding-y: 0.4rem;
  --bs-btn-padding-x: 0.9rem;
  --bs-btn-border-radius: var(--pb-radius-sm);
}

.name-error {
  margin: 0;
  font-size: 0.85rem;
  color: var(--pb-danger-text);
}

.rank-progress-count {
  margin: 0 0 0.5rem;
  font-weight: 700;
}

.rank-progress-next {
  margin: 0.5rem 0 0;
  font-size: 0.85rem;
  color: var(--pb-text-muted);
}

.trainer-facts {
  display: grid;
  gap: 0.75rem;
  margin: 0;
  padding-top: 1rem;
  border-top: 1px solid var(--pb-border);
}

.trainer-facts dt,
.stat dt {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--pb-text-muted);
}

.trainer-facts dd {
  margin: 0.15rem 0 0;
  font-weight: 600;
  overflow-wrap: anywhere;
}

/* ---------- Showcase ---------- */

.showcase-card {
  position: relative;
  width: min(70vw, 280px);
  margin: 0 auto;
}

.showcase-glow {
  position: absolute;
  inset: -6%;
  border-radius: 12%;
  background: var(--pb-holo);
  filter: blur(26px);
  opacity: 0.35;
}

.showcase-card[data-tier='ultra'] .showcase-glow {
  opacity: 0.75;
}

.showcase-caption {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.25rem 0.4rem;
  margin: 1rem 0 0;
  text-align: center;
}

.showcase-mode {
  flex-basis: 100%;
  font-size: 0.8rem;
  color: var(--pb-text-muted);
}

.showcase-empty {
  padding: 1.5rem;
  border-radius: var(--pb-radius-md);
  border: 1px dashed var(--pb-border-strong);
  text-align: center;
  color: var(--pb-text-muted);
}

/* ---------- Stats ---------- */

.stat-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  margin: 0;
}

.stat {
  padding: 1rem 1.1rem;
  border-radius: var(--pb-radius-md);
  border: 1px solid var(--pb-border);
  background: var(--pb-surface);
}

.stat:last-child {
  grid-column: 1 / -1;
}

.stat dd {
  margin: 0.3rem 0 0;
  font-family: var(--pb-font-display);
  font-size: 1.5rem;
  font-weight: 800;
}

/* ---------- Rarity breakdown ---------- */

.rarity-bar {
  display: flex;
  height: 16px;
  gap: 2px;
  border-radius: 999px;
  overflow: hidden;
  background: var(--pb-input-bg);
}

.rarity-bar span {
  min-width: 4px;
  transition: width 0.8s var(--pb-ease-out);
}

.rarity-legend {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 0.5rem 1rem;
  margin: 1rem 0 0;
  padding: 0;
  list-style: none;
}

.rarity-legend li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
}

.rarity-legend li.empty {
  opacity: 0.5;
}

.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  flex-shrink: 0;
}

.legend-name {
  flex: 1;
}

.legend-count {
  font-weight: 800;
}

/* ---------- Achievements ---------- */

/* Not .badge: Bootstrap already styles that class (centered, nowrap) */
.achv-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.achv {
  display: flex;
  gap: 0.8rem;
  align-items: flex-start;
  padding: 0.85rem;
  border-radius: var(--pb-radius-md);
  border: 1px solid var(--pb-border);
  background: var(--pb-input-bg);
}

.achv-icon {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: var(--pb-selected);
  color: var(--pb-text-muted);
}

.achv-icon svg {
  width: 22px;
  height: 22px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.achv.unlocked {
  border-color: transparent;
  background:
    linear-gradient(var(--pb-bg-elevated), var(--pb-bg-elevated)) padding-box,
    var(--pb-holo) border-box;
  border: 1px solid transparent;
}

.achv.unlocked .achv-icon {
  background: var(--pb-holo);
  color: #0a0d1a;
}

.achv-body {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
  flex: 1;
}

.achv-title {
  font-weight: 800;
}

.achv:not(.unlocked) .achv-title {
  color: var(--pb-text-muted);
}

.achv-desc {
  font-size: 0.8rem;
  color: var(--pb-text-muted);
}

.achv-progress {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.35rem;
}

.achv-progress-text {
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--pb-text-muted);
  white-space: nowrap;
}

/* ---------- Account ---------- */

.account {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.account .pb-section-title {
  margin-bottom: 0.25rem;
}

/* ---------- Breakpoints ---------- */

@media (min-width: 768px) {
  .stat-grid {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }

  .stat:last-child {
    grid-column: auto;
  }
}

@media (min-width: 992px) {
  .profile-layout {
    grid-template-columns: 360px minmax(0, 1fr);
    align-items: start;
    gap: 2rem;
  }

  .profile-side {
    position: sticky;
    top: 1rem;
  }

  .stat-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .stat:nth-child(4),
  .stat:nth-child(5) {
    grid-column: span 1;
  }
}

@media (min-width: 1200px) {
  .stat-grid {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
}
</style>
