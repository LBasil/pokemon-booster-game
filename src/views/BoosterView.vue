<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { fetchSetCover } from '@/api/sets'
import { drawBooster } from '@/api/boosters'
import { addCardsToCollection } from '@/api/collection'
import { useCollectionStore } from '@/stores/collection'
import { useSetsStore } from '@/stores/sets'
import { groupCardsByQuantity } from '@/utils/cards'
import { bestPull, rarityLabelKey, rarityRank, rarityTier, sortForReveal } from '@/utils/rarity'
import { setLogoUrl, setSymbolUrl } from '@/utils/sets'
import AppHeader from '@/components/AppHeader.vue'
import BoosterArt from '@/components/BoosterArt.vue'
import BoosterPack, { TEAR_MS } from '@/components/BoosterPack.vue'
import CardStack from '@/components/CardStack.vue'
import HoloCard from '@/components/HoloCard.vue'
import SetPicker from '@/components/SetPicker.vue'

const { t, locale } = useI18n()
const collectionStore = useCollectionStore()
const setsStore = useSetsStore()

const COUNT_OPTIONS = [1, 3, 5, 10]

// ---------- Set selection ----------

const sets = computed(() => setsStore.sets)
const selectedSetId = ref('')
const count = ref(1)
const setsLoading = computed(() => !setsStore.loaded && !setsStore.error)
const loadError = computed(() => (setsStore.error ? t('boosters.loadError') : ''))

const selectedSet = computed(() => sets.value.find((set) => set.id === selectedSetId.value) ?? null)

// Chase card per set, used as pack artwork (cached; failures just fall back)
const covers = ref({})
watch(selectedSetId, async (setId) => {
  if (!setId || setId in covers.value) return
  covers.value = { ...covers.value, [setId]: null }
  try {
    const cover = await fetchSetCover(setId)
    covers.value = { ...covers.value, [setId]: cover }
  } catch {
    // keep null: the pack renders without artwork
  }
})

// Props for BoosterArt / BoosterPack; no set = the generic "any set" pack
function packArt(set) {
  if (!set) return {}
  return {
    name: set.name,
    logo: setLogoUrl(set),
    symbol: setSymbolUrl(set),
    artwork: covers.value[set.id]?.image_url ?? null,
  }
}

const pack = computed(() => packArt(selectedSet.value))

const releaseYear = computed(() => selectedSet.value?.release_date?.slice(0, 4) ?? null)

// Desktop shows the picker inline; phones open it in a bottom sheet
const desktopQuery = window.matchMedia('(min-width: 992px)')
const isDesktop = ref(desktopQuery.matches)
const onMediaChange = (event) => (isDesktop.value = event.matches)
const pickerDialog = ref(null)

function openPicker() {
  pickerDialog.value?.showModal()
}

function closePicker() {
  pickerDialog.value?.close()
}

watch(selectedSetId, () => {
  if (!isDesktop.value) closePicker()
})

// Card ids the user owned before this visit, to flag new pulls (null = unknown)
let ownedIds = null

onMounted(() => {
  desktopQuery.addEventListener('change', onMediaChange)

  collectionStore.load().then(() => {
    if (!collectionStore.error) ownedIds = new Set(collectionStore.entries.map((entry) => entry.card_id))
  })

  setsStore.load()
})

onBeforeUnmount(() => {
  desktopQuery.removeEventListener('change', onMediaChange)
  clearTimeout(tearTimer)
})

// ---------- Opening flow ----------

const phase = ref('select') // select | open | done
const step = ref('pack') // pack | reveal (within the open phase)
const packState = ref('loading') // loading | ready | tearing
const boosterIndex = ref(0)
const totalToOpen = ref(0)
const currentCards = ref([]) // [{ key, card, isNew }] for the pack being revealed
const revealedCount = ref(0)
const pulled = ref([]) // same shape, every card of this session
const openError = ref('')
const openedSetId = ref('')
const packSetId = ref('') // set the current pack came from (differs for "any set")
const stage = ref(null)
let tearTimer = null

async function startOpening() {
  totalToOpen.value = count.value
  openedSetId.value = selectedSetId.value
  boosterIndex.value = 0
  pulled.value = []
  openError.value = ''
  phase.value = 'open'
  window.scrollTo({ top: 0 })
  await prepareBooster()
}

// Draws a pack and records it in the collection right away, so leaving
// mid-reveal never loses cards. The pack becomes tappable once saved.
async function prepareBooster() {
  step.value = 'pack'
  packState.value = 'loading'
  revealedCount.value = 0

  try {
    const cards = await drawBooster(openedSetId.value || null)
    await addCardsToCollection(cards)
    collectionStore.invalidate()
    packSetId.value = cards[0]?.set_id ?? openedSetId.value

    currentCards.value = sortForReveal(cards).map((card, index) => {
      const isNew = ownedIds ? !ownedIds.has(card.id) : false
      ownedIds?.add(card.id)
      return { key: `${boosterIndex.value}-${index}-${card.id}`, card, isNew }
    })
    preloadImages(cards)
    packState.value = 'ready'
    focusStage()
  } catch {
    openError.value = t('boosters.openError')
    phase.value = pulled.value.length ? 'done' : 'select'
  }
}

function preloadImages(cards) {
  for (const card of cards) {
    const img = new Image()
    img.sizes = '(max-width: 576px) 68vw, 300px'
    if (card.image_small && card.image_url) img.srcset = `${card.image_small} 245w, ${card.image_url} 734w`
    img.src = card.image_small || card.image_url
  }
}

function tearPack() {
  if (packState.value !== 'ready') return
  packState.value = 'tearing'
  tearTimer = setTimeout(() => {
    step.value = 'reveal'
    focusStage()
  }, TEAR_MS)
}

async function onStackTap() {
  if (revealedCount.value < currentCards.value.length) {
    revealedCount.value++
    return
  }
  await finishBooster()
}

async function finishBooster() {
  pulled.value.push(...currentCards.value)
  boosterIndex.value++
  if (boosterIndex.value < totalToOpen.value) {
    await prepareBooster()
  } else {
    phase.value = 'done'
    window.scrollTo({ top: 0 })
  }
}

// Keep keyboard focus on the thing to press next (pack, then pile)
function focusStage() {
  nextTick(() => stage.value?.querySelector('button')?.focus({ preventScroll: true }))
}

function backToSelect() {
  phase.value = 'select'
  pulled.value = []
}

const currentCard = computed(() =>
  step.value === 'reveal' && revealedCount.value > 0 ? currentCards.value[revealedCount.value - 1] : null,
)
const isLastBooster = computed(() => boosterIndex.value + 1 >= totalToOpen.value)

const hint = computed(() => {
  if (step.value === 'pack') return packState.value === 'loading' ? t('boosters.preparing') : t('boosters.tapToOpen')
  if (revealedCount.value < currentCards.value.length) return t('boosters.tapToReveal')
  return isLastBooster.value ? t('boosters.tapToFinish') : t('boosters.tapToContinue')
})

const setName = (setId) => sets.value.find((set) => set.id === setId)?.name ?? null
const openedSetName = computed(() => setName(openedSetId.value) ?? t('boosters.anySet'))
const openedPackArt = computed(() => packArt(sets.value.find((set) => set.id === openedSetId.value)))

// "Any set" packs stay a mystery until torn open, then show where they're from
const stageLabel = computed(() => {
  if (openedSetId.value || step.value !== 'reveal') return openedSetName.value
  const from = setName(packSetId.value)
  return from ? `${t('boosters.anySet')} · ${from}` : openedSetName.value
})

// Chip label for anything rarer than an uncommon
function rarityChip(card) {
  const key = rarityLabelKey(card)
  return key === 'common' || key === 'uncommon' ? null : t(`boosters.bucket.${key}`)
}

// ---------- Summary ----------

const summary = computed(() => {
  const newIds = new Set(pulled.value.filter((item) => item.isNew).map((item) => item.card.id))
  const grouped = groupCardsByQuantity(pulled.value.map((item) => item.card)).map((entry) => ({
    ...entry,
    tier: rarityTier(entry.card),
    chip: rarityChip(entry.card),
    isNew: newIds.has(entry.card.id),
  }))
  grouped.sort((a, b) => rarityRank(b.card) - rarityRank(a.card) || b.isNew - a.isNew)

  return {
    entries: grouped,
    total: pulled.value.length,
    newCount: newIds.size,
    rareCount: pulled.value.filter((item) => rarityTier(item.card) !== 'common').length,
    best: bestPull(pulled.value.map((item) => item.card)),
  }
})

const formatNumber = (value) => value.toLocaleString(locale.value)
</script>

<template>
  <div class="pb-page">
    <AppHeader />

    <main class="container boosters">
      <!-- ============ Choose a booster ============ -->
      <section v-if="phase === 'select'" class="select-layout">
        <div class="select-main">
          <span class="pb-eyebrow">{{ t('boosters.eyebrow') }}</span>
          <h1 class="boosters-title">{{ t('boosters.title') }}</h1>

          <div class="preview-stage" :style="{ '--stack': Math.min(count, 3) }" aria-hidden="true">
            <BoosterArt v-if="count > 2" class="preview-pack preview-pack-2" v-bind="pack" />
            <BoosterArt v-if="count > 1" class="preview-pack preview-pack-1" v-bind="pack" />
            <BoosterArt class="preview-pack preview-pack-0" v-bind="pack" />
          </div>

          <div class="preview-info">
            <h2 class="preview-name">{{ selectedSet?.name ?? t('boosters.anySet') }}</h2>
            <p class="preview-meta">
              <template v-if="selectedSet">
                <span v-if="releaseYear">{{ t('boosters.releasedIn', { year: releaseYear }) }}</span>
                <span v-if="releaseYear && selectedSet.total" aria-hidden="true"> · </span>
                <span v-if="selectedSet.total">{{ t('boosters.cardCount', { count: selectedSet.total }) }}</span>
              </template>
              <template v-else>{{ t('boosters.anySetDesc') }}</template>
            </p>
            <button v-if="!isDesktop" type="button" class="btn btn-outline-secondary" @click="openPicker">
              {{ t('boosters.changeSet') }}
            </button>
          </div>

          <div class="count-picker">
            <span id="count-label" class="form-label">{{ t('boosters.countLabel') }}</span>
            <div class="count-options" role="radiogroup" aria-labelledby="count-label">
              <button
                v-for="n in COUNT_OPTIONS"
                :key="n"
                type="button"
                role="radio"
                :aria-checked="count === n"
                :class="{ active: count === n }"
                @click="count = n"
              >
                {{ n }}
              </button>
            </div>
          </div>

          <div v-if="loadError" class="alert alert-danger" role="alert">{{ loadError }}</div>
          <div v-if="openError" class="alert alert-danger" role="alert">{{ openError }}</div>

          <button type="button" class="btn btn-primary btn-lg glow-button open-button" @click="startOpening">
            {{ t('boosters.openButton', { count }, count) }}
          </button>
        </div>

        <aside v-if="isDesktop" class="select-side">
          <h2 class="pb-section-title mb-3">{{ t('boosters.seriesTitle') }}</h2>
          <SetPicker v-model="selectedSetId" :sets="sets" :loading="setsLoading" />
        </aside>

        <dialog v-else ref="pickerDialog" class="picker-sheet" @click.self="closePicker">
          <div class="picker-sheet-inner">
            <div class="picker-sheet-head">
              <h2 class="pb-section-title">{{ t('boosters.seriesTitle') }}</h2>
              <button type="button" class="picker-close" :aria-label="t('boosters.closePicker')" @click="closePicker">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            <SetPicker v-model="selectedSetId" :sets="sets" :loading="setsLoading" />
          </div>
        </dialog>
      </section>

      <!-- ============ Opening ============ -->
      <section v-else-if="phase === 'open'" class="open-layout">
        <div class="open-top">
          <span class="pb-eyebrow">{{ stageLabel }}</span>
          <p v-if="totalToOpen > 1" class="open-progress-label">
            {{ t('boosters.boosterProgress', { current: boosterIndex + 1, total: totalToOpen }) }}
          </p>
        </div>

        <div ref="stage" class="open-stage">
          <BoosterPack
            v-if="step === 'pack'"
            :key="`pack-${boosterIndex}`"
            :state="packState"
            v-bind="openedPackArt"
            @open="tearPack"
          />
          <CardStack v-else :cards="currentCards" :revealed-count="revealedCount" @tap="onStackTap" />
        </div>

        <div class="open-caption" aria-live="polite">
          <!-- Keyed per card so the fade-in replays; hits wait for their flip -->
          <div
            v-if="currentCard"
            :key="currentCard.key"
            class="open-card-info"
            :data-tier="rarityTier(currentCard.card)"
          >
            <p class="open-card-name">{{ currentCard.card.name }}</p>
            <div class="open-card-badges">
              <span v-if="rarityChip(currentCard.card)" class="tier-chip" :data-tier="rarityTier(currentCard.card)">
                {{ rarityChip(currentCard.card) }}
              </span>
              <span v-if="currentCard.isNew" class="new-chip">{{ t('boosters.newBadge') }}</span>
            </div>
          </div>
          <p class="open-hint">{{ hint }}</p>
        </div>

        <div v-if="step === 'reveal'" class="open-dots" aria-hidden="true">
          <span
            v-for="(item, index) in currentCards"
            :key="item.key"
            :class="{ done: index < revealedCount, rare: index < revealedCount && rarityTier(item.card) !== 'common' }"
          ></span>
        </div>

        <button v-if="step === 'reveal'" type="button" class="btn btn-link open-skip" @click="finishBooster">
          {{ isLastBooster ? t('boosters.skipToSummary') : t('boosters.skip') }}
        </button>
      </section>

      <!-- ============ Summary ============ -->
      <section v-else class="done-layout">
        <div class="done-head">
          <span class="pb-eyebrow">{{ openedSetName }}</span>
          <h1 class="boosters-title">
            <span class="pb-holo-text">{{ formatNumber(summary.total) }}</span>
            {{ t('boosters.doneTitle', summary.total) }}
          </h1>
          <p class="done-stats">
            <span>{{ t('boosters.newCount', { count: summary.newCount }, summary.newCount) }}</span>
            <span aria-hidden="true">·</span>
            <span>{{ t('boosters.rareCount', { count: summary.rareCount }, summary.rareCount) }}</span>
          </p>
          <div v-if="openError" class="alert alert-danger" role="alert">{{ openError }}</div>
        </div>

        <div class="done-body">
          <figure v-if="summary.best" class="done-best">
            <figcaption class="done-best-label">{{ t('boosters.bestPull') }}</figcaption>
            <HoloCard
              :src="summary.best.image_small || summary.best.image_url"
              :srcset="summary.best.image_small && summary.best.image_url ? `${summary.best.image_small} 245w, ${summary.best.image_url} 734w` : null"
              sizes="260px"
              :alt="summary.best.name"
              eager
            />
            <p class="done-best-name">{{ summary.best.name }}</p>
          </figure>

          <ul class="done-grid" role="list">
            <li v-for="entry in summary.entries" :key="entry.card.id" class="done-card">
              <div class="done-card-img">
                <HoloCard :src="entry.card.image_small || entry.card.image_url" :alt="entry.card.name" :max-tilt="10" />
                <span v-if="entry.quantity > 1" class="done-qty">{{ t('collection.quantity', { quantity: entry.quantity }) }}</span>
              </div>
              <span class="done-card-name">{{ entry.card.name }}</span>
              <span class="done-card-badges">
                <span v-if="entry.chip" class="tier-chip" :data-tier="entry.tier">{{ entry.chip }}</span>
                <span v-if="entry.isNew" class="new-chip">{{ t('boosters.newBadge') }}</span>
              </span>
            </li>
          </ul>
        </div>

        <div class="done-actions">
          <button type="button" class="btn btn-primary btn-lg glow-button" @click="startOpening">
            {{ t('boosters.openAgain', { count: totalToOpen }, totalToOpen) }}
          </button>
          <button type="button" class="btn btn-outline-secondary btn-lg" @click="backToSelect">
            {{ t('boosters.changeSet') }}
          </button>
          <RouterLink :to="{ name: 'collection' }" class="btn btn-link">
            {{ t('game.viewCollection') }}
          </RouterLink>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.boosters {
  padding-top: 1rem;
}

.boosters-title {
  margin: 1rem 0 0;
  font-size: clamp(1.8rem, 5vw, 2.8rem);
  font-weight: 800;
}

/* ---------- Select ---------- */

.select-layout {
  display: grid;
  gap: 2rem;
}

.select-main {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  animation: pb-rise 0.6s var(--pb-ease-out) both;
}

.select-main .boosters-title {
  margin-bottom: 1.5rem;
}

.preview-stage {
  --booster-w: clamp(130px, 36vw, 200px);
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  height: calc(var(--booster-w) * 1.6 + 30px);
}

.preview-pack {
  position: absolute;
  transition: transform 0.5s var(--pb-ease-out);
}

.preview-pack-0 {
  animation: preview-float 5s ease-in-out infinite;
}

.preview-pack-1 {
  transform: translateX(28%) rotate(9deg) scale(0.92);
  filter: brightness(0.75);
}

.preview-pack-2 {
  transform: translateX(-28%) rotate(-9deg) scale(0.92);
  filter: brightness(0.75);
}

@keyframes preview-float {
  0%,
  100% {
    transform: translateY(0) rotate(-2deg);
  }
  50% {
    transform: translateY(-8px) rotate(1deg);
  }
}

.preview-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  margin: 1.25rem 0 1.5rem;
}

.preview-name {
  margin: 0;
  font-size: 1.35rem;
}

.preview-meta {
  margin: 0 0 0.5rem;
  color: var(--pb-text-muted);
}

.count-picker {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 1.5rem;
}

.count-options {
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  border-radius: var(--pb-radius-md);
  border: 1px solid var(--pb-border-strong);
  background: var(--pb-surface);
}

.count-options button {
  min-width: 56px;
  height: 44px;
  border: none;
  border-radius: calc(var(--pb-radius-md) - 4px);
  background: none;
  color: var(--pb-text-muted);
  font-family: var(--pb-font-display);
  font-weight: 700;
  font-size: 1.05rem;
  transition:
    background-color 0.2s,
    color 0.2s;
}

.count-options button:hover {
  color: var(--pb-text);
}

.count-options button.active {
  background: var(--pb-text);
  color: var(--pb-bg);
}

.open-button {
  width: 100%;
  max-width: 360px;
}

/* Phones: keep the main action reachable above the tab bar */
@media (max-width: 767.98px) {
  .open-button {
    position: sticky;
    bottom: calc(92px + env(safe-area-inset-bottom));
    z-index: 5;
    box-shadow: var(--pb-shadow-lg);
  }
}

.select-main .alert {
  width: 100%;
  max-width: 360px;
}

.select-side {
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 140px);
  position: sticky;
  top: 1rem;
  padding: 1.5rem;
  border-radius: var(--pb-radius-lg);
  border: 1px solid var(--pb-border);
  background: var(--pb-bg-elevated);
  box-shadow: var(--pb-shadow-card);
  animation: pb-rise 0.6s 0.1s var(--pb-ease-out) both;
}

.select-side :deep(.set-picker) {
  flex: 1;
}

/* Bottom sheet (phones) */
.picker-sheet {
  width: 100%;
  max-width: 100%;
  height: 85dvh;
  max-height: 85dvh;
  margin: auto 0 0;
  padding: 0;
  border: none;
  border-radius: var(--pb-radius-lg) var(--pb-radius-lg) 0 0;
  background: var(--pb-bg-elevated);
  color: var(--pb-text);
  box-shadow: var(--pb-shadow-lg);
}

.picker-sheet[open] {
  animation: sheet-up 0.35s var(--pb-ease-out);
}

.picker-sheet::backdrop {
  background: rgba(5, 7, 15, 0.6);
  backdrop-filter: blur(4px);
}

.picker-sheet-inner {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 1.25rem 1rem calc(1rem + env(safe-area-inset-bottom));
}

.picker-sheet-inner :deep(.set-picker) {
  flex: 1;
}

.picker-sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.picker-close {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid var(--pb-border-strong);
  background: none;
  color: var(--pb-text);
}

.picker-close svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}

@keyframes sheet-up {
  from {
    transform: translateY(100%);
  }
}

/* ---------- Opening ---------- */

.open-layout {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 1rem;
  padding-bottom: 1rem;
}

.open-top {
  position: relative;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.open-progress-label {
  margin: 0;
  font-weight: 700;
  color: var(--pb-text-muted);
}

.open-stage {
  display: grid;
  place-items: center;
  width: 100%;
  min-height: calc(min(68vw, 300px) * 88 / 63 + 40px);
  padding: 1rem 0;
  /* Clip cards flying off sideways, but let halos spill vertically */
  overflow-x: clip;
}

.open-caption {
  position: relative;
  z-index: 2;
  min-height: 5.5rem;
}

/* Name and badges appear as the card turns face-up (later for hits, which
   charge up for ~1s first — revealing "Secret rare" early would spoil it) */
.open-card-info {
  animation: caption-in 0.3s 0.3s backwards;
}

.open-card-info[data-tier='ultra'] {
  animation-delay: 1s;
}

@keyframes caption-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}

.open-card-name {
  margin: 0 0 0.4rem;
  font-family: var(--pb-font-display);
  font-size: 1.3rem;
  font-weight: 700;
}

.open-card-badges,
.done-card-badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.4rem;
}

.open-hint {
  margin: 0.6rem 0 0;
  color: var(--pb-text-muted);
}

.open-dots {
  display: flex;
  gap: 6px;
}

.open-dots span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--pb-border-strong);
  transition: background-color 0.3s;
}

.open-dots span.done {
  background: var(--pb-text-muted);
}

.open-dots span.rare {
  background: var(--pb-accent);
  transition-delay: 1s;
}

.open-skip {
  font-weight: 700;
}

.tier-chip,
.new-chip {
  display: inline-block;
  padding: 0.2rem 0.65rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.tier-chip {
  color: var(--pb-text);
  border: 1px solid var(--pb-border-strong);
}

.tier-chip[data-tier='ultra'] {
  color: #0a0d1a;
  border-color: transparent;
  background: var(--pb-holo);
}

.new-chip {
  color: var(--pb-accent-ink);
  background: var(--pb-accent);
}

/* ---------- Summary ---------- */

.done-layout {
  display: flex;
  flex-direction: column;
  gap: 2rem;
}

.done-head {
  animation: pb-rise 0.6s var(--pb-ease-out) both;
}

.done-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0.75rem 0 0;
  color: var(--pb-text-muted);
  font-size: 1.05rem;
}

.done-body {
  display: grid;
  gap: 2rem;
  animation: pb-rise 0.6s 0.1s var(--pb-ease-out) both;
}

.done-best {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  margin: 0;
}

.done-best :deep(.holo-card) {
  width: min(60vw, 260px);
}

.done-best-label {
  font-size: 0.8rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--pb-text-muted);
}

.done-best-name {
  margin: 0;
  font-family: var(--pb-font-display);
  font-size: 1.2rem;
  font-weight: 700;
}

.done-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
  gap: 1.25rem 1rem;
  margin: 0;
  padding: 0;
  list-style: none;
  align-content: start;
}

.done-card {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 0;
}

.done-card-img {
  position: relative;
}

.done-qty {
  position: absolute;
  top: 6px;
  right: 6px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(10, 13, 26, 0.85);
  color: #fff;
  font-size: 0.75rem;
  font-weight: 800;
}

.done-card-name {
  font-size: 0.85rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.done-card-badges {
  justify-content: flex-start;
}

.done-card-badges .tier-chip,
.done-card-badges .new-chip {
  font-size: 0.62rem;
  padding: 0.15rem 0.5rem;
}

.done-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}

@media (max-width: 575.98px) {
  .done-actions .btn-lg {
    width: 100%;
  }

  .done-actions .btn-link {
    width: 100%;
  }
}

@media (min-width: 992px) {
  .select-layout {
    grid-template-columns: minmax(0, 1fr) minmax(0, 420px);
    align-items: start;
    gap: 3rem;
  }

  .preview-stage {
    --booster-w: 210px;
  }

  .done-body {
    grid-template-columns: 300px minmax(0, 1fr);
    align-items: start;
  }

  .done-best {
    position: sticky;
    top: 1rem;
  }
}
</style>
