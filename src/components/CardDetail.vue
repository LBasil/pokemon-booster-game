<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { cardNumber } from '@/utils/collection'
import { rarityLabelKey, rarityTier } from '@/utils/rarity'
import { setLogoUrl } from '@/utils/sets'
import HoloCard from '@/components/HoloCard.vue'

// Full-size view of one owned card. Opens whenever `entry` is set; arrows
// (keyboard, buttons or a horizontal swipe) move through the current list.
const props = defineProps({
  entry: { type: Object, default: null },
  set: { type: Object, default: null },
  hasPrev: { type: Boolean, default: false },
  hasNext: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'prev', 'next'])

const { t, te, locale } = useI18n()
const dialog = ref(null)

watch(
  () => props.entry,
  async (entry) => {
    await nextTick()
    if (entry && !dialog.value?.open) dialog.value?.showModal()
    if (!entry && dialog.value?.open) dialog.value.close()
  },
)

const card = computed(() => props.entry?.cards ?? null)
const tier = computed(() => (card.value ? rarityTier(card.value) : 'common'))
const bucket = computed(() => (card.value ? rarityLabelKey(card.value) : 'common'))

const acquired = computed(() =>
  props.entry?.acquired_at
    ? new Date(props.entry.acquired_at).toLocaleDateString(locale.value, { day: 'numeric', month: 'long', year: 'numeric' })
    : null,
)
const value = computed(() =>
  card.value?.value
    ? new Intl.NumberFormat(locale.value, { style: 'currency', currency: 'EUR' }).format(card.value.value)
    : null,
)

// Energy types come from the API in English; unknown ones are shown as-is
const typeLabel = (type) => (te(`collection.types.${type}`) ? t(`collection.types.${type}`) : type)

function onKeydown(event) {
  if (event.key === 'ArrowLeft' && props.hasPrev) emit('prev')
  if (event.key === 'ArrowRight' && props.hasNext) emit('next')
}

// Horizontal swipe on the card switches cards on touch screens
let swipeStart = null
function onPointerDown(event) {
  if (event.pointerType !== 'mouse') swipeStart = event.clientX
}
function onPointerUp(event) {
  if (swipeStart === null) return
  const dx = event.clientX - swipeStart
  swipeStart = null
  if (dx > 60 && props.hasPrev) emit('prev')
  if (dx < -60 && props.hasNext) emit('next')
}
</script>

<template>
  <dialog
    ref="dialog"
    class="card-detail"
    :aria-label="card?.name"
    @close="emit('close')"
    @click.self="dialog.close()"
    @keydown="onKeydown"
  >
    <div v-if="card" class="card-detail-inner">
      <button type="button" class="detail-close" :aria-label="t('collection.close')" @click="dialog.close()">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>

      <div class="detail-visual" :data-tier="tier" @pointerdown="onPointerDown" @pointerup="onPointerUp">
        <span class="detail-glow" aria-hidden="true"></span>
        <HoloCard
          :key="card.id"
          :src="card.image_small || card.image_url"
          :srcset="card.image_small && card.image_url ? `${card.image_small} 245w, ${card.image_url} 734w` : null"
          sizes="(max-width: 767px) 70vw, 340px"
          :alt="card.name"
          eager
        />
      </div>

      <div class="detail-info">
        <div v-if="set" class="detail-set">
          <span class="detail-set-plate"><img :src="setLogoUrl(set)" alt="" /></span>
          <span>
            <span class="detail-set-name">{{ set.name }}</span>
            <span class="detail-set-number">
              {{ t('collection.number', { number: cardNumber(card.id), total: set.printed_total || set.total }) }}
            </span>
          </span>
        </div>

        <h2 class="detail-name">{{ card.name }}</h2>

        <div class="detail-chips">
          <span v-if="bucket !== 'common' && bucket !== 'uncommon'" class="tier-chip" :data-tier="tier">
            {{ t(`boosters.bucket.${bucket}`) }}
          </span>
          <span v-else-if="card.rarity" class="tier-chip">{{ card.rarity }}</span>
          <span class="qty-chip">{{ t('collection.ownedCopies', { count: entry.quantity }, entry.quantity) }}</span>
        </div>

        <dl class="detail-facts">
          <div v-if="acquired">
            <dt>{{ t('collection.firstPulled') }}</dt>
            <dd>{{ acquired }}</dd>
          </div>
          <div v-if="card.rarity">
            <dt>{{ t('collection.rarity') }}</dt>
            <dd>{{ card.rarity }}</dd>
          </div>
          <div v-if="card.hp || card.types?.length">
            <dt>{{ t('collection.stats') }}</dt>
            <dd>
              <template v-if="card.hp">{{ t('collection.hp', { hp: card.hp }) }}</template>
              <template v-if="card.hp && card.types?.length"> · </template>
              <template v-if="card.types?.length">{{ card.types.map(typeLabel).join(', ') }}</template>
            </dd>
          </div>
          <div v-if="card.artist">
            <dt>{{ t('collection.artist') }}</dt>
            <dd>{{ card.artist }}</dd>
          </div>
          <div v-if="value">
            <dt>{{ t('collection.marketValue') }}</dt>
            <dd>{{ value }}</dd>
          </div>
        </dl>

        <div class="detail-nav">
          <button type="button" class="btn btn-outline-secondary" :disabled="!hasPrev" @click="emit('prev')">
            <span aria-hidden="true">←</span> {{ t('collection.previous') }}
          </button>
          <button type="button" class="btn btn-outline-secondary" :disabled="!hasNext" @click="emit('next')">
            {{ t('collection.next') }} <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.card-detail {
  width: min(880px, calc(100% - 2rem));
  max-width: none;
  max-height: calc(100dvh - 2rem);
  padding: 0;
  border: 1px solid var(--pb-border);
  border-radius: var(--pb-radius-lg);
  background: var(--pb-bg-elevated);
  color: var(--pb-text);
  box-shadow: var(--pb-shadow-lg);
  overflow-y: auto;
}

.card-detail[open] {
  animation: detail-in 0.3s var(--pb-ease-out);
}

.card-detail::backdrop {
  background: rgba(5, 7, 15, 0.7);
  backdrop-filter: blur(6px);
}

.card-detail-inner {
  position: relative;
  display: grid;
  gap: 1.5rem;
  padding: 1.5rem;
}

.detail-close {
  position: absolute;
  top: 0.75rem;
  right: 0.75rem;
  z-index: 2;
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: 1px solid var(--pb-border-strong);
  background: var(--pb-bg-elevated);
  color: var(--pb-text);
}

.detail-close svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}

.detail-visual {
  position: relative;
  justify-self: center;
  width: min(70vw, 340px);
  touch-action: pan-y;
}

.detail-glow {
  position: absolute;
  inset: -6%;
  border-radius: 12%;
  background: var(--pb-holo);
  filter: blur(28px);
  opacity: 0;
}

.detail-visual[data-tier='rare'] .detail-glow {
  opacity: 0.4;
}

.detail-visual[data-tier='ultra'] .detail-glow {
  opacity: 0.75;
}

.detail-info {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-width: 0;
}

.detail-set {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding-right: 2.5rem;
}

.detail-set > span:last-child {
  display: flex;
  flex-direction: column;
}

.detail-set-plate {
  display: grid;
  place-items: center;
  width: 84px;
  height: 44px;
  padding: 5px 7px;
  border-radius: var(--pb-radius-sm);
  background: linear-gradient(160deg, #1d2450, #0a0d1a);
  flex-shrink: 0;
}

.detail-set-plate img {
  max-width: 70px;
  max-height: 34px;
  object-fit: contain;
}

.detail-set-name {
  font-weight: 700;
}

.detail-set-number {
  font-size: 0.85rem;
  color: var(--pb-text-muted);
}

.detail-name {
  margin: 0;
  font-size: clamp(1.6rem, 4vw, 2.2rem);
  font-weight: 800;
  overflow-wrap: anywhere;
}

.detail-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.tier-chip,
.qty-chip {
  display: inline-block;
  padding: 0.25rem 0.7rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  border: 1px solid var(--pb-border-strong);
}

.tier-chip[data-tier='ultra'] {
  color: #0a0d1a;
  border-color: transparent;
  background: var(--pb-holo);
}

.qty-chip {
  background: var(--pb-selected);
  border-color: transparent;
}

.detail-facts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 0.9rem 1.5rem;
  margin: 0;
  padding: 1rem 0;
  border-top: 1px solid var(--pb-border);
  border-bottom: 1px solid var(--pb-border);
}

.detail-facts dt {
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--pb-text-muted);
}

.detail-facts dd {
  margin: 0.15rem 0 0;
  font-weight: 600;
}

.detail-nav {
  display: flex;
  gap: 0.75rem;
  margin-top: auto;
}

.detail-nav .btn {
  flex: 1;
}

@keyframes detail-in {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.98);
  }
}

@media (min-width: 768px) {
  .card-detail-inner {
    grid-template-columns: 340px minmax(0, 1fr);
    gap: 2.5rem;
    padding: 2.5rem;
  }

  .detail-visual {
    width: 340px;
  }
}
</style>
