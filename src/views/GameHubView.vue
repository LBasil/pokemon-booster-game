<script setup>
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useCollectionStore } from '@/stores/collection'
import { completionPercent } from '@/utils/progress'
import AppHeader from '@/components/AppHeader.vue'
import BoosterArt from '@/components/BoosterArt.vue'
import HoloCard from '@/components/HoloCard.vue'

const { t, locale } = useI18n()
const auth = useAuthStore()
const collectionStore = useCollectionStore()

onMounted(() => {
  collectionStore.load()
})

const formatNumber = (value) => value.toLocaleString(locale.value)

const initial = computed(() => auth.displayName.charAt(0).toUpperCase() || '?')
const memberSince = computed(() =>
  auth.user?.created_at
    ? new Date(auth.user.created_at).toLocaleDateString(locale.value, { month: 'long', year: 'numeric' })
    : '',
)

const stats = computed(() => collectionStore.stats)
const percent = computed(() => completionPercent(stats.value.uniqueOwned, stats.value.totalCards))
const percentLabel = computed(() =>
  new Intl.NumberFormat(locale.value, { maximumFractionDigits: 1 }).format(percent.value),
)

// First load only: later visits show cached data while refreshing
const firstLoad = computed(() => collectionStore.loading && !collectionStore.loaded)
</script>

<template>
  <div class="pb-page">
    <AppHeader />

    <main class="container hub">
      <section class="hub-intro">
        <span class="pb-eyebrow">{{ t('game.eyebrow') }}</span>
        <i18n-t keypath="game.greeting" tag="h1" class="hub-title" scope="global">
          <template #name>
            <span class="pb-holo-text">{{ auth.displayName }}</span>
          </template>
        </i18n-t>
        <p class="hub-subtitle">{{ t('game.subtitle') }}</p>
      </section>

      <div class="hub-grid">
        <!-- Main action -->
        <RouterLink :to="{ name: 'boosters' }" class="hub-tile hub-feature">
          <div class="hub-feature-text">
            <span class="hub-tag">{{ t('game.featureTag') }}</span>
            <h2 class="hub-feature-title">{{ t('game.openBoosters') }}</h2>
            <p class="hub-tile-desc">{{ t('game.openBoostersDesc') }}</p>
            <span class="btn btn-primary btn-lg glow-button hub-feature-cta">
              {{ t('game.openCta') }}
              <span aria-hidden="true">→</span>
            </span>
          </div>
          <div class="hub-feature-art" aria-hidden="true">
            <BoosterArt class="pack pack-back" />
            <BoosterArt class="pack pack-front" />
          </div>
        </RouterLink>

        <!-- Collection progress -->
        <RouterLink :to="{ name: 'collection' }" class="hub-tile hub-collection">
          <div class="hub-tile-head">
            <h2 class="hub-tile-title">{{ t('game.viewCollection') }}</h2>
            <span class="hub-tile-arrow" aria-hidden="true">→</span>
          </div>

          <template v-if="firstLoad">
            <div class="pb-skeleton" style="height: 2.2rem; width: 60%"></div>
            <div class="pb-skeleton mt-3" style="height: 10px"></div>
          </template>
          <template v-else>
            <p class="hub-big-number">
              {{ formatNumber(stats.uniqueOwned) }}
              <span class="hub-big-number-total">/ {{ formatNumber(stats.totalCards) }}</span>
            </p>
            <div
              class="hub-progress"
              role="progressbar"
              :aria-label="t('game.progressLabel')"
              aria-valuemin="0"
              aria-valuemax="100"
              :aria-valuenow="percent"
            >
              <span :style="{ width: `${Math.max(percent, stats.uniqueOwned ? 1.5 : 0)}%` }"></span>
            </div>
            <p class="hub-tile-desc mb-0 mt-2">
              {{ t('game.progress', { percent: percentLabel }) }}
            </p>
          </template>
        </RouterLink>

        <!-- Profile summary -->
        <RouterLink :to="{ name: 'profile' }" class="hub-tile hub-profile">
          <div class="hub-avatar" aria-hidden="true">{{ initial }}</div>
          <div class="hub-profile-text">
            <h2 class="hub-tile-title">{{ auth.displayName }}</h2>
            <p v-if="memberSince" class="hub-tile-desc mb-0">
              {{ t('game.memberSince', { date: memberSince }) }}
            </p>
            <p v-if="!firstLoad" class="hub-tile-desc mb-0">
              {{ t('game.totalDrawn', { count: formatNumber(collectionStore.totalDrawn) }, collectionStore.totalDrawn) }}
            </p>
          </div>
          <span class="hub-tile-arrow" aria-hidden="true">→</span>
        </RouterLink>
      </div>

      <!-- Latest pulls -->
      <section class="hub-recent" aria-labelledby="hub-recent-title">
        <div class="hub-section-head">
          <h2 id="hub-recent-title" class="pb-section-title">{{ t('game.recentTitle') }}</h2>
          <RouterLink
            v-if="collectionStore.recentEntries.length"
            :to="{ name: 'collection' }"
            class="hub-see-all"
          >
            {{ t('game.seeAll') }}
          </RouterLink>
        </div>

        <div v-if="collectionStore.error" class="alert alert-danger" role="alert">
          {{ t('game.loadError') }}
        </div>

        <div v-else-if="firstLoad" class="hub-recent-row">
          <div v-for="n in 6" :key="n" class="hub-recent-item">
            <div class="pb-skeleton" style="aspect-ratio: 63 / 88"></div>
          </div>
        </div>

        <div v-else-if="collectionStore.recentEntries.length === 0" class="hub-empty">
          <BoosterArt class="hub-empty-art" />
          <div>
            <h3 class="hub-empty-title">{{ t('game.emptyTitle') }}</h3>
            <p class="hub-tile-desc">{{ t('game.emptyDesc') }}</p>
            <RouterLink :to="{ name: 'boosters' }" class="btn btn-primary glow-button">
              {{ t('game.openCta') }}
            </RouterLink>
          </div>
        </div>

        <ul v-else class="hub-recent-row" role="list">
          <li v-for="entry in collectionStore.recentEntries" :key="entry.card_id" class="hub-recent-item">
            <HoloCard :src="entry.cards.image_small || entry.cards.image_url" :alt="entry.cards.name" :max-tilt="10" />
            <span class="hub-recent-name">{{ entry.cards.name }}</span>
            <span v-if="entry.quantity > 1" class="hub-recent-qty">
              {{ t('collection.quantity', { quantity: entry.quantity }) }}
            </span>
          </li>
        </ul>
      </section>
    </main>
  </div>
</template>

<style scoped>
.hub {
  display: flex;
  flex-direction: column;
  gap: 2rem;
  padding-top: 1rem;
}

.hub-intro {
  animation: pb-rise 0.6s var(--pb-ease-out) both;
}

.hub-title {
  margin: 1rem 0 0.5rem;
  font-size: clamp(1.8rem, 5vw, 3rem);
  font-weight: 800;
  overflow-wrap: anywhere;
}

.hub-subtitle {
  margin: 0;
  color: var(--pb-text-muted);
  font-size: 1.05rem;
}

/* ---------- Tiles ---------- */

.hub-grid {
  display: grid;
  gap: 1rem;
  animation: pb-rise 0.6s 0.1s var(--pb-ease-out) both;
}

.hub-tile {
  position: relative;
  display: block;
  padding: 1.5rem;
  border-radius: var(--pb-radius-lg);
  border: 1px solid var(--pb-border);
  background: var(--pb-surface);
  box-shadow: var(--pb-shadow-card);
  backdrop-filter: blur(14px);
  color: var(--pb-text);
  overflow: hidden;
  transition:
    transform 0.3s var(--pb-ease-out),
    border-color 0.3s,
    background-color 0.3s;
}

.hub-tile:hover {
  transform: translateY(-3px);
  border-color: var(--pb-border-strong);
  background: var(--pb-surface-hover);
  color: var(--pb-text);
}

.hub-tile-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.hub-tile-title {
  font-size: 1.15rem;
  margin: 0;
  overflow-wrap: anywhere;
}

.hub-tile-desc {
  color: var(--pb-text-muted);
  font-size: 0.95rem;
  line-height: 1.5;
}

.hub-tile-arrow {
  font-size: 1.2rem;
  color: var(--pb-text-muted);
  transition:
    transform 0.3s var(--pb-ease-out),
    color 0.2s;
}

.hub-tile:hover .hub-tile-arrow {
  transform: translateX(4px);
  color: var(--pb-text);
}

/* Feature tile: open boosters */
.hub-feature {
  display: flex;
  flex-direction: column-reverse;
  gap: 1.5rem;
  padding: 1.75rem;
  background:
    radial-gradient(90% 120% at 100% 0%, color-mix(in srgb, #a78bfa 22%, transparent), transparent 60%),
    var(--pb-surface);
}

.hub-feature::before {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  height: 2px;
  background: var(--pb-holo);
  opacity: 0.8;
}

.hub-tag {
  display: inline-block;
  padding: 0.25rem 0.7rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--pb-accent) 18%, transparent);
  color: var(--pb-text);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.hub-feature-title {
  margin: 0.9rem 0 0.6rem;
  font-size: clamp(1.6rem, 4vw, 2.3rem);
  font-weight: 800;
}

.hub-feature-text .hub-tile-desc {
  max-width: 26rem;
  margin-bottom: 1.5rem;
}

.hub-feature-art {
  --booster-w: 110px;
  position: relative;
  height: calc(var(--booster-w) * 1.6 + 20px);
  display: grid;
  place-items: center;
}

.pack {
  position: absolute;
  transition: transform 0.5s var(--pb-ease-out);
}

.pack-back {
  transform: translateX(28%) rotate(12deg) scale(0.92);
  filter: saturate(0.8) brightness(0.85);
}

.pack-front {
  transform: translateX(-18%) rotate(-8deg);
}

.hub-feature:hover .pack-front {
  transform: translateX(-22%) translateY(-6%) rotate(-12deg);
}

.hub-feature:hover .pack-back {
  transform: translateX(34%) rotate(16deg) scale(0.92);
}

/* Collection tile */
.hub-big-number {
  margin: 0 0 0.9rem;
  font-family: var(--pb-font-display);
  font-size: 2rem;
  font-weight: 800;
  line-height: 1;
}

.hub-big-number-total {
  font-size: 1rem;
  font-weight: 600;
  color: var(--pb-text-muted);
}

.hub-progress {
  height: 10px;
  border-radius: 999px;
  background: var(--pb-input-bg);
  border: 1px solid var(--pb-border);
  overflow: hidden;
}

.hub-progress span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--pb-holo);
  transition: width 0.8s var(--pb-ease-out);
}

/* Profile tile */
.hub-profile {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.hub-profile-text {
  flex: 1;
  min-width: 0;
}

.hub-avatar {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  font-family: var(--pb-font-display);
  font-size: 1.4rem;
  font-weight: 800;
  color: var(--pb-text);
  background:
    linear-gradient(var(--pb-bg-elevated), var(--pb-bg-elevated)) padding-box,
    var(--pb-holo) border-box;
  border: 3px solid transparent;
}

/* ---------- Latest pulls ---------- */

.hub-recent {
  animation: pb-rise 0.6s 0.2s var(--pb-ease-out) both;
}

.hub-section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.hub-see-all {
  font-weight: 700;
  font-size: 0.9rem;
}

.hub-recent-row {
  display: flex;
  scroll-padding-inline: calc(var(--bs-gutter-x) * 0.5);
  gap: 1rem;
  margin: 0 calc(var(--bs-gutter-x) * -0.5);
  padding: 0.5rem calc(var(--bs-gutter-x) * 0.5) 1rem;
  list-style: none;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  scrollbar-width: thin;
}

.hub-recent-item {
  flex: 0 0 clamp(120px, 34vw, 150px);
  scroll-snap-align: start;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.hub-recent-name {
  font-size: 0.85rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hub-recent-qty {
  margin-top: -0.3rem;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--pb-text-muted);
}

.hub-empty {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  padding: 1.5rem;
  border-radius: var(--pb-radius-lg);
  border: 1px dashed var(--pb-border-strong);
}

.hub-empty-art {
  --booster-w: 72px;
  flex-shrink: 0;
  transform: rotate(-6deg);
}

.hub-empty-title {
  font-size: 1.05rem;
  margin: 0 0 0.4rem;
}

/* ---------- Breakpoints ---------- */

/* Phones & tablets: small packs tucked top-right so the CTA stays above the fold */
@media (max-width: 991.98px) {
  .hub-feature-art {
    --booster-w: 64px;
    position: absolute;
    top: 1.25rem;
    right: 1.5rem;
    width: 100px;
    height: 110px;
  }

  .hub-tag,
  .hub-feature-title {
    max-width: calc(100% - 100px);
  }
}

@media (min-width: 768px) {
  .hub-grid {
    grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
  }

  .hub-feature {
    grid-row: span 2;
  }
}

@media (min-width: 992px) {
  .hub-feature {
    flex-direction: row;
    align-items: center;
    padding: 2.25rem;
  }

  .hub-feature-text {
    flex: 1;
  }

  .hub-feature-art {
    --booster-w: clamp(110px, 12vw, 150px);
    flex: 0 0 45%;
  }
}
</style>
