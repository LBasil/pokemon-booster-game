<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useChallengeStore } from '@/stores/challenge'
import { useChallengeCollectionStore } from '@/stores/collection'
import { useSettingsStore } from '@/stores/settings'
import { useTradesStore } from '@/stores/trades'
import { RECYCLE_KEEP_OPTIONS, duplicateGroups, recycleKeep, recyclePreview, recycleValue } from '@/utils/challenge'
import CoinAmount from '@/components/CoinAmount.vue'
import CopyStepper from '@/components/CopyStepper.vue'

// Challenge mode: "N duplicates → +X coins", then either a two-step button
// that recycles every copy beyond the ones kept, or "Choose": a list of the
// cards with extra copies, by rarity, to tick the ones to recycle, all
// their extra copies or, with − / +, only some (recycle_card_copies,
// migration 0020). "Keep" (1 to 4 copies of each card, remembered on this
// device) sets what counts as extra; 1 = recycle_duplicates (0005).
const emit = defineEmits(['recycled', 'error'])

const { t, locale } = useI18n()
const challenge = useChallengeStore()
const collection = useChallengeCollectionStore()
const trades = useTradesStore()
const settings = useSettingsStore()

const keep = computed(() => recycleKeep(settings.recycleKeep))
function setKeep(value) {
  settings.set('recycleKeep', recycleKeep(Number(value)))
  picked.value = new Map()
}

const preview = computed(() => recyclePreview(collection.entries, null, keep.value))
const confirming = ref(false)
const busy = ref(false)

// ---------- Choose ----------

const choosing = ref(false)
// card id -> copies to recycle (1 to its extra copies)
const picked = ref(new Map())
const groups = computed(() => duplicateGroups(collection.entries, keep.value))
const pickedPreview = computed(() => recyclePreview(collection.entries, picked.value, keep.value))

const extraOf = (entry) => Math.max(0, entry.quantity - keep.value)
const copiesOf = (entry) => picked.value.get(entry.card_id) ?? 0

function startChoosing() {
  confirming.value = false
  picked.value = new Map()
  trades.loadLocks()
  choosing.value = true
}

function setCopies(entry, copies) {
  const next = new Map(picked.value)
  const count = Math.min(Math.max(copies, 0), extraOf(entry))
  if (count) next.set(entry.card_id, count)
  else next.delete(entry.card_id)
  picked.value = next
}

// The checkbox takes every extra copy, or none
const toggle = (entry) => setCopies(entry, copiesOf(entry) ? 0 : extraOf(entry))

// A rarity chip ticks all of that rarity (every extra copy), or unticks them when they all are
const bucketPicked = (group) => group.entries.every((entry) => copiesOf(entry) === extraOf(entry))
function toggleBucket(group) {
  const next = new Map(picked.value)
  const all = bucketPicked(group)
  for (const entry of group.entries) {
    if (all) next.delete(entry.card_id)
    else next.set(entry.card_id, extraOf(entry))
  }
  picked.value = next
}

async function run(cards) {
  busy.value = true
  try {
    const result = await challenge.recycle(cards)
    confirming.value = false
    choosing.value = false
    picked.value = new Map()
    emit('recycled', result)
  } catch (err) {
    emit('error', err)
  } finally {
    busy.value = false
  }
}

// The server only knows "keep 1": past that, every extra copy goes as a pick
function recycleCopies(copies) {
  const extras = Object.fromEntries(collection.entries.map((entry) => [entry.card_id, entry.quantity - 1]))
  const picks = Object.fromEntries([...copies].map(([id, count]) => [id, Math.min(count, extras[id] ?? 0)]))
  run({ picks, extras })
}

function recycleAll() {
  if (keep.value === 1) return run(null)
  recycleCopies(new Map(collection.entries.filter((entry) => extraOf(entry) > 0).map((entry) => [entry.card_id, extraOf(entry)])))
}
const recyclePicked = () => recycleCopies(picked.value)
</script>

<template>
  <div class="recycle" :class="{ 'is-choosing': choosing }">
    <div class="recycle-row">
      <p class="recycle-text">
        <template v-if="preview.cards">
          {{ t('challenge.recycleable', { count: preview.cards.toLocaleString(locale) }, preview.cards) }}
          <CoinAmount class="recycle-coins" :amount="preview.coins" signed />
        </template>
        <template v-else>{{ keep > 1 ? t('challenge.keep.nothing', { count: keep }, keep) : t('challenge.noDuplicates') }}</template>
      </p>
      <label class="recycle-keep">
        <span>{{ t('challenge.keep.label') }}</span>
        <select class="form-select form-select-sm" :value="keep" :disabled="busy" @change="setKeep($event.target.value)">
          <option v-for="n in RECYCLE_KEEP_OPTIONS" :key="n" :value="n">{{ t('challenge.keep.option', { count: n }, n) }}</option>
        </select>
      </label>
      <template v-if="preview.cards && !choosing">
        <div v-if="confirming" class="recycle-actions">
          <button type="button" class="btn btn-primary btn-sm" :disabled="busy" @click="recycleAll">
            <span v-if="busy" class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>
            {{ t('challenge.recycleConfirm') }}
          </button>
          <button type="button" class="btn btn-outline-secondary btn-sm" :disabled="busy" @click="confirming = false">
            {{ t('common.cancel') }}
          </button>
        </div>
        <div v-else class="recycle-actions">
          <button type="button" class="btn btn-outline-secondary btn-sm" @click="startChoosing">
            {{ t('challenge.pick.choose') }}
          </button>
          <button type="button" class="btn btn-outline-secondary btn-sm" @click="confirming = true">
            {{ t('challenge.recycleAll') }}
          </button>
        </div>
      </template>
    </div>

    <!-- ============ Choose what to recycle ============ -->
    <div v-if="choosing && preview.cards" class="pick" role="group" :aria-label="t('challenge.pick.title')">
      <p class="pick-hint">{{ t('challenge.pick.hint') }}</p>
      <div class="pick-chips">
        <button
          v-for="group in groups"
          :key="group.bucket"
          type="button"
          class="pick-chip"
          :data-bucket="group.bucket"
          :aria-pressed="bucketPicked(group)"
          @click="toggleBucket(group)"
        >
          <span class="pick-dot" aria-hidden="true"></span>
          {{ t(`challenge.pick.buckets.${group.bucket}`) }}
          <span class="pick-chip-count">{{ group.entries.length }}</span>
        </button>
      </div>

      <div class="pick-list">
        <section v-for="group in groups" :key="group.bucket" class="pick-group">
          <h3 class="pick-group-title">{{ t(`challenge.pick.buckets.${group.bucket}`) }}</h3>
          <ul class="pick-rows" role="list">
            <li v-for="entry in group.entries" :key="entry.card_id" class="pick-row" :class="{ picked: copiesOf(entry) }">
              <label class="pick-label">
                <input type="checkbox" class="form-check-input" :checked="copiesOf(entry) > 0" @change="toggle(entry)" />
                <img :src="entry.cards.image_small" alt="" loading="lazy" class="pick-img" />
                <span class="pick-name">
                  {{ entry.cards.name }}
                  <span class="pick-meta">
                    {{ t('challenge.pick.extra', { count: extraOf(entry) }, extraOf(entry)) }}
                    <span v-if="trades.isLocked(entry.card_id)" class="pick-lock">· {{ t('trades.notForTrade') }}</span>
                  </span>
                </span>
              </label>
              <div class="pick-side">
                <!-- How many copies, when there's more than one to choose from -->
                <CopyStepper
                  v-if="extraOf(entry) > 1"
                  :model-value="copiesOf(entry)"
                  :max="extraOf(entry)"
                  :name="entry.cards.name"
                  @update:model-value="setCopies(entry, $event)"
                />
                <CoinAmount class="pick-coins" :amount="(copiesOf(entry) || extraOf(entry)) * recycleValue(entry.cards)" signed />
              </div>
            </li>
          </ul>
        </section>
      </div>

      <div class="pick-footer">
        <p class="pick-total" aria-live="polite">
          {{ t('challenge.pick.total', { count: pickedPreview.cards.toLocaleString(locale) }, pickedPreview.cards) }}
          <CoinAmount v-if="pickedPreview.cards" class="recycle-coins" :amount="pickedPreview.coins" signed />
        </p>
        <div class="recycle-actions">
          <button type="button" class="btn btn-primary btn-sm" :disabled="busy || !pickedPreview.cards" @click="recyclePicked">
            <span v-if="busy" class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>
            {{ t('challenge.pick.recycle', { count: pickedPreview.cards }, pickedPreview.cards) }}
          </button>
          <button type="button" class="btn btn-outline-secondary btn-sm" :disabled="busy" @click="choosing = false">
            {{ t('common.cancel') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.recycle {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-width: 0;
}

.recycle-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.recycle-keep {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--pb-text-muted);
}

.recycle-keep .form-select {
  width: auto;
}

.recycle-text {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  font-weight: 600;
  font-size: 0.92rem;
}

.recycle-coins {
  color: var(--pb-coin);
  font-weight: 800;
}

.recycle-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

/* ---------- Choose ---------- */

.pick {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
}

.pick-hint {
  margin: 0;
  color: var(--pb-text-muted);
  font-size: 0.85rem;
}

.pick-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.pick-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.7rem;
  border-radius: 999px;
  border: 1px solid var(--pb-border-strong);
  background: var(--pb-surface);
  color: var(--pb-text);
  font-size: 0.8rem;
  font-weight: 700;
}

.pick-chip[aria-pressed='true'] {
  border-color: transparent;
  background: var(--pb-selected);
  box-shadow: 0 0 0 2px var(--pb-ring);
}

.pick-dot {
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 50%;
  background: var(--pb-bucket-common);
}

.pick-chip[data-bucket='uncommon'] .pick-dot {
  background: var(--pb-bucket-uncommon);
}

.pick-chip[data-bucket='rare'] .pick-dot {
  background: var(--pb-bucket-rare);
}

.pick-chip[data-bucket='holo'] .pick-dot {
  background: var(--pb-bucket-holo);
}

.pick-chip[data-bucket='ultra'] .pick-dot {
  background: var(--pb-bucket-ultra);
}

.pick-chip[data-bucket='secret'] .pick-dot {
  background: var(--pb-bucket-secret);
}

.pick-chip-count {
  color: var(--pb-text-muted);
  font-weight: 600;
}

/* Long lists scroll inside, the total and buttons stay in view */
.pick-list {
  max-height: min(26rem, 60vh);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-right: 0.25rem;
}

.pick-group + .pick-group {
  margin-top: 0.75rem;
}

.pick-group-title {
  margin: 0 0 0.35rem;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--pb-text-muted);
}

.pick-rows {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.pick-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 0.65rem;
  padding: 0.4rem 0.6rem;
  border-radius: var(--pb-radius-sm);
  border: 1px solid var(--pb-border);
}

.pick-label {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  flex: 1 1 12rem;
  min-width: 0;
  cursor: pointer;
}

.pick-side {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  margin-left: auto;
}

.pick-label .form-check-input {
  flex-shrink: 0;
  margin: 0;
}

.pick-img {
  flex-shrink: 0;
  width: 32px;
  aspect-ratio: 63 / 88;
  border-radius: 3px;
  object-fit: cover;
}

.pick-name {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  font-weight: 600;
  font-size: 0.88rem;
  overflow-wrap: anywhere;
}

.pick-meta {
  color: var(--pb-text-muted);
  font-size: 0.75rem;
  font-weight: 500;
}

.pick-coins {
  flex-shrink: 0;
  color: var(--pb-coin);
  font-weight: 800;
  font-size: 0.85rem;
}

.pick-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--pb-border);
}

.pick-total {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  font-weight: 700;
  font-size: 0.9rem;
}
</style>
