<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { fetchChallengeCollectionOf } from '@/api/challenge'
import { useChallengeCollectionStore } from '@/stores/collection'
import { useTradesStore } from '@/stores/trades'
import { rarityTier } from '@/utils/rarity'
import { timeAgo } from '@/utils/time'
import { TRADE_MAX_CARDS, searchEntries, toggleCard } from '@/utils/trades'
import AppHeader from '@/components/AppHeader.vue'

// Trades between players (challenge mode): answer offers, follow the ones
// you sent, and build a new one (?to=<username> prefills the partner, e.g.
// from a public profile, and ?want=<card id> one of their cards). The
// server checks and swaps the cards.
const { t, locale } = useI18n()
const route = useRoute()
const trades = useTradesStore()
const myCollection = useChallengeCollectionStore()

onMounted(() => {
  trades.load({ force: true })
  myCollection.load()
})

const groups = computed(() => trades.groups)
const firstLoad = computed(() => !trades.loaded && !trades.error)

// ---------- Feedback ----------

const notice = ref('')
const errorMessage = ref('')
const busyId = ref(null)

function showError(err) {
  notice.value = ''
  errorMessage.value = t(err?.code ? `challenge.errors.${err.code}` : 'challenge.errors.generic')
}

async function act(id, task) {
  busyId.value = id
  notice.value = ''
  errorMessage.value = ''
  try {
    notice.value = await task()
  } catch (err) {
    showError(err)
  } finally {
    busyId.value = null
  }
}

const respond = (trade, accept) =>
  act(trade.id, async () => t(`trades.result.${await trades.respond(trade.id, accept)}`))
const cancel = (trade) =>
  act(trade.id, async () => {
    await trades.cancel(trade.id)
    return t('trades.result.cancelled')
  })

// ---------- New offer ----------

const partnerName = ref(typeof route.query.to === 'string' ? route.query.to : '')
const partner = ref(null) // { username, entries } once found
const partnerState = ref('idle') // idle | loading | empty | error
const giving = ref([]) // my card ids
const asking = ref([]) // partner card ids
const giveQuery = ref('')
const askQuery = ref('')
const sending = ref(false)

async function findPartner() {
  const name = partnerName.value.trim()
  if (!name) return
  partnerState.value = 'loading'
  partner.value = null
  asking.value = []
  errorMessage.value = ''
  try {
    const entries = await fetchChallengeCollectionOf(name)
    partner.value = { username: name, entries }
    partnerState.value = entries.length ? 'idle' : 'empty'
    // ?want=<card id> (a public profile's "Ask for it"): already picked
    const wanted = route.query.want
    if (typeof wanted === 'string' && entries.some((entry) => entry.card_id === wanted)) asking.value = [wanted]
  } catch (err) {
    partnerState.value = 'error'
    showError(err)
  }
}

onMounted(() => {
  if (partnerName.value) findPartner()
})
watch(
  () => route.query.to,
  (to) => {
    if (typeof to === 'string' && to !== partnerName.value) {
      partnerName.value = to
      findPartner()
    }
  },
)

// Pickers show 60 matches at most: search narrows big collections
const PICKER_LIMIT = 60
const giveOptions = computed(() => searchEntries(myCollection.entries, giveQuery.value).slice(0, PICKER_LIMIT))
const askOptions = computed(() => searchEntries(partner.value?.entries ?? [], askQuery.value).slice(0, PICKER_LIMIT))

const cardById = computed(() => {
  const map = {}
  for (const entry of [...myCollection.entries, ...(partner.value?.entries ?? [])]) map[entry.card_id] = entry.cards
  return map
})

const canSend = computed(() => partner.value && giving.value.length > 0 && !sending.value)

async function send() {
  if (!canSend.value) return
  sending.value = true
  notice.value = ''
  errorMessage.value = ''
  try {
    await trades.propose(partner.value.username, giving.value, asking.value)
    notice.value = t('trades.sentNotice', { name: partner.value.username })
    giving.value = []
    asking.value = []
  } catch (err) {
    showError(err)
  } finally {
    sending.value = false
  }
}

const statusLabel = (status) => t(`trades.status.${status}`)
const ago = (iso) => timeAgo(iso, locale.value)
</script>

<template>
  <div class="pb-page">
    <AppHeader />

    <main class="container trades">
      <header>
        <h1 class="trades-title">{{ t('trades.title') }}</h1>
        <p class="pb-muted">{{ t('trades.subtitle', { max: TRADE_MAX_CARDS }) }}</p>
      </header>

      <p class="trades-feedback" role="status" aria-live="polite">
        <span v-if="notice" class="trades-notice">{{ notice }}</span>
      </p>
      <div v-if="errorMessage" class="alert alert-danger" role="alert">{{ errorMessage }}</div>
      <div v-if="trades.error" class="alert alert-danger" role="alert">{{ t('trades.loadError') }}</div>

      <div v-if="firstLoad" class="trades-list">
        <div v-for="n in 2" :key="n" class="pb-skeleton" style="height: 120px; border-radius: var(--pb-radius-md)"></div>
      </div>

      <template v-else>
        <!-- ============ Received ============ -->
        <section v-if="groups.received.length" aria-labelledby="trades-received">
          <h2 id="trades-received" class="pb-section-title">
            {{ t('trades.received') }} <span class="trades-count">{{ groups.received.length }}</span>
          </h2>
          <ul class="trades-list" role="list">
            <li v-for="trade in groups.received" :key="trade.id" class="trade">
              <p class="trade-head">
                <RouterLink :to="{ name: 'public-profile', params: { username: trade.partner } }" class="trade-partner">{{ trade.partner }}</RouterLink>
                <span class="trade-time">{{ ago(trade.created_at) }}</span>
              </p>
              <div class="trade-sides">
                <div class="trade-side">
                  <span class="trade-side-label">{{ t('trades.youGet') }}</span>
                  <ul class="trade-cards" role="list">
                    <li v-for="card in trade.offer" :key="card.id" :data-tier="rarityTier(card)">
                      <img :src="card.image_small" :alt="card.name" :title="card.name" loading="lazy" />
                    </li>
                  </ul>
                </div>
                <span class="trade-arrow" aria-hidden="true">⇄</span>
                <div class="trade-side">
                  <span class="trade-side-label">{{ t('trades.youGive') }}</span>
                  <ul v-if="trade.request.length" class="trade-cards" role="list">
                    <li v-for="card in trade.request" :key="card.id" :data-tier="rarityTier(card)">
                      <img :src="card.image_small" :alt="card.name" :title="card.name" loading="lazy" />
                    </li>
                  </ul>
                  <p v-else class="trade-gift">{{ t('trades.gift') }}</p>
                </div>
              </div>
              <div class="trade-actions">
                <button type="button" class="btn btn-primary btn-sm" :disabled="busyId === trade.id" @click="respond(trade, true)">
                  {{ t('trades.accept') }}
                </button>
                <button type="button" class="btn btn-outline-secondary btn-sm" :disabled="busyId === trade.id" @click="respond(trade, false)">
                  {{ t('trades.decline') }}
                </button>
              </div>
            </li>
          </ul>
        </section>

        <!-- ============ New offer ============ -->
        <section class="composer" aria-labelledby="trades-new">
          <h2 id="trades-new" class="pb-section-title">{{ t('trades.newTitle') }}</h2>

          <form class="composer-find" @submit.prevent="findPartner">
            <label for="trade-partner" class="form-label">{{ t('trades.partnerLabel') }}</label>
            <div class="composer-find-row">
              <input
                id="trade-partner"
                v-model="partnerName"
                type="text"
                class="form-control"
                autocomplete="off"
                :placeholder="t('trades.partnerPlaceholder')"
              />
              <button type="submit" class="btn btn-outline-secondary" :disabled="!partnerName.trim() || partnerState === 'loading'">
                {{ t('trades.find') }}
              </button>
            </div>
            <p v-if="partnerState === 'empty'" class="composer-hint">{{ t('trades.partnerEmpty', { name: partnerName.trim() }) }}</p>
          </form>

          <div v-if="partner && partnerState === 'idle'" class="composer-pickers">
            <!-- My cards -->
            <fieldset class="picker">
              <legend class="picker-title">
                {{ t('trades.youGive') }}
                <span class="picker-count">{{ giving.length }}/{{ TRADE_MAX_CARDS }}</span>
              </legend>
              <input v-model="giveQuery" type="search" class="form-control form-control-sm" :placeholder="t('trades.search')" :aria-label="t('trades.searchMine')" />
              <p v-if="!myCollection.entries.length" class="composer-hint">{{ t('trades.noCards') }}</p>
              <ul class="picker-grid" role="list">
                <li v-for="entry in giveOptions" :key="entry.card_id">
                  <button
                    type="button"
                    class="picker-card"
                    :data-tier="rarityTier(entry.cards)"
                    :aria-pressed="giving.includes(entry.card_id)"
                    :disabled="!giving.includes(entry.card_id) && giving.length >= TRADE_MAX_CARDS"
                    @click="giving = toggleCard(giving, entry.card_id)"
                  >
                    <img :src="entry.cards.image_small" alt="" loading="lazy" />
                    <span class="picker-name">{{ entry.cards.name }}</span>
                    <span v-if="entry.quantity > 1" class="picker-qty">x{{ entry.quantity }}</span>
                  </button>
                </li>
              </ul>
            </fieldset>

            <!-- Their cards -->
            <fieldset class="picker">
              <legend class="picker-title">
                {{ t('trades.youAsk', { name: partner.username }) }}
                <span class="picker-count">{{ asking.length }}/{{ TRADE_MAX_CARDS }}</span>
              </legend>
              <input v-model="askQuery" type="search" class="form-control form-control-sm" :placeholder="t('trades.search')" :aria-label="t('trades.searchTheirs')" />
              <ul class="picker-grid" role="list">
                <li v-for="entry in askOptions" :key="entry.card_id">
                  <button
                    type="button"
                    class="picker-card"
                    :data-tier="rarityTier(entry.cards)"
                    :aria-pressed="asking.includes(entry.card_id)"
                    :disabled="!asking.includes(entry.card_id) && asking.length >= TRADE_MAX_CARDS"
                    @click="asking = toggleCard(asking, entry.card_id)"
                  >
                    <img :src="entry.cards.image_small" alt="" loading="lazy" />
                    <span class="picker-name">{{ entry.cards.name }}</span>
                  </button>
                </li>
              </ul>
            </fieldset>

            <div class="composer-summary">
              <p class="composer-summary-text">
                <template v-if="giving.length">
                  {{ giving.map((id) => cardById[id]?.name).join(', ') }}
                  <span aria-hidden="true">⇄</span>
                  {{ asking.length ? asking.map((id) => cardById[id]?.name).join(', ') : t('trades.gift') }}
                </template>
                <template v-else>{{ t('trades.pickHint') }}</template>
              </p>
              <button type="button" class="btn btn-primary glow-button" :disabled="!canSend" @click="send">
                <span v-if="sending" class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
                {{ t('trades.send', { name: partner.username }) }}
              </button>
            </div>
          </div>
        </section>

        <!-- ============ Sent ============ -->
        <section v-if="groups.sent.length" aria-labelledby="trades-sent">
          <h2 id="trades-sent" class="pb-section-title">{{ t('trades.sent') }}</h2>
          <ul class="trades-list" role="list">
            <li v-for="trade in groups.sent" :key="trade.id" class="trade">
              <p class="trade-head">
                <span>{{ t('trades.to') }} <RouterLink :to="{ name: 'public-profile', params: { username: trade.partner } }" class="trade-partner">{{ trade.partner }}</RouterLink></span>
                <span class="trade-time">{{ ago(trade.created_at) }}</span>
              </p>
              <div class="trade-sides">
                <div class="trade-side">
                  <span class="trade-side-label">{{ t('trades.youGive') }}</span>
                  <ul class="trade-cards" role="list">
                    <li v-for="card in trade.offer" :key="card.id" :data-tier="rarityTier(card)">
                      <img :src="card.image_small" :alt="card.name" :title="card.name" loading="lazy" />
                    </li>
                  </ul>
                </div>
                <span class="trade-arrow" aria-hidden="true">⇄</span>
                <div class="trade-side">
                  <span class="trade-side-label">{{ t('trades.youGet') }}</span>
                  <ul v-if="trade.request.length" class="trade-cards" role="list">
                    <li v-for="card in trade.request" :key="card.id" :data-tier="rarityTier(card)">
                      <img :src="card.image_small" :alt="card.name" :title="card.name" loading="lazy" />
                    </li>
                  </ul>
                  <p v-else class="trade-gift">{{ t('trades.gift') }}</p>
                </div>
              </div>
              <div class="trade-actions">
                <span class="trade-waiting">{{ t('trades.waiting') }}</span>
                <button type="button" class="btn btn-outline-secondary btn-sm" :disabled="busyId === trade.id" @click="cancel(trade)">
                  {{ t('trades.cancel') }}
                </button>
              </div>
            </li>
          </ul>
        </section>

        <!-- ============ History ============ -->
        <section v-if="groups.history.length" aria-labelledby="trades-history">
          <h2 id="trades-history" class="pb-section-title">{{ t('trades.history') }}</h2>
          <ul class="history-rows" role="list">
            <li v-for="trade in groups.history" :key="trade.id" class="history-row">
              <span class="history-status" :data-status="trade.status">{{ statusLabel(trade.status) }}</span>
              <span class="history-text">
                {{ trade.direction === 'sent' ? t('trades.to') : t('trades.from') }}
                <strong>{{ trade.partner }}</strong> ·
                {{ trade.offer.map((card) => card.name).join(', ') }}
                <span aria-hidden="true">⇄</span>
                {{ trade.request.length ? trade.request.map((card) => card.name).join(', ') : t('trades.gift') }}
              </span>
              <span class="trade-time">{{ ago(trade.resolved_at ?? trade.created_at) }}</span>
            </li>
          </ul>
        </section>

        <p v-if="!trades.trades.length" class="pb-muted">{{ t('trades.empty') }}</p>
      </template>

      <RouterLink :to="{ name: 'challenge' }" class="trades-back"><span aria-hidden="true">←</span> {{ t('challenge.backToHub') }}</RouterLink>
    </main>
  </div>
</template>

<style scoped>
.trades {
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
  padding-top: 1rem;
}

.trades-title {
  margin: 1rem 0 0.5rem;
  font-size: clamp(1.8rem, 5vw, 2.6rem);
  font-weight: 800;
}

.trades-feedback {
  margin: -1rem 0 0;
}

.trades-notice {
  display: inline-block;
  padding: 0.5rem 1rem;
  border-radius: 999px;
  background: var(--pb-success-bg);
  color: var(--pb-success-text);
  font-weight: 700;
}

.trades-count {
  display: inline-grid;
  place-items: center;
  min-width: 1.4rem;
  height: 1.4rem;
  margin-left: 0.3rem;
  padding: 0 0.35rem;
  border-radius: 999px;
  background: var(--pb-accent);
  color: var(--pb-accent-ink);
  font-size: 0.8rem;
  vertical-align: 2px;
}

.trades-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin: 0.75rem 0 0;
  padding: 0;
  list-style: none;
}

/* ---------- An offer ---------- */

.trade {
  padding: 1rem;
  border-radius: var(--pb-radius-md);
  border: 1px solid var(--pb-border);
  background: var(--pb-surface);
}

.trade-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
  margin: 0 0 0.75rem;
  font-weight: 600;
}

.trade-partner {
  font-weight: 800;
}

.trade-time {
  flex-shrink: 0;
  color: var(--pb-text-muted);
  font-size: 0.8rem;
  font-weight: 600;
}

.trade-sides {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.trade-side {
  flex: 1;
  min-width: 0;
}

.trade-side-label {
  display: block;
  margin-bottom: 0.35rem;
  color: var(--pb-text-muted);
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.trade-arrow {
  color: var(--pb-text-muted);
  font-size: 1.4rem;
}

.trade-cards {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.trade-cards img {
  display: block;
  width: 48px;
  aspect-ratio: 63 / 88;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid var(--pb-border);
}

.trade-cards li[data-tier='rare'] img {
  box-shadow: 0 0 0 2px var(--pb-bucket-holo);
}

.trade-cards li[data-tier='ultra'] img {
  box-shadow: 0 0 0 2px var(--pb-bucket-secret);
}

.trade-gift {
  margin: 0;
  color: var(--pb-text-muted);
  font-style: italic;
}

.trade-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.9rem;
}

.trade-waiting {
  margin-right: auto;
  color: var(--pb-text-muted);
  font-size: 0.85rem;
}

/* ---------- Composer ---------- */

.composer {
  padding: 1.25rem;
  border-radius: var(--pb-radius-lg);
  border: 1px solid var(--pb-border);
  background: var(--pb-surface);
}

.composer-find {
  margin-top: 0.75rem;
  max-width: 28rem;
}

.composer-find-row {
  display: flex;
  gap: 0.5rem;
}

.composer-hint {
  margin: 0.5rem 0 0;
  color: var(--pb-text-muted);
  font-size: 0.9rem;
}

.composer-pickers {
  display: grid;
  gap: 1.25rem;
  margin-top: 1.25rem;
}

.picker {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: none;
}

.picker-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
  font-family: var(--pb-font-display);
  font-size: 1rem;
  font-weight: 700;
}

.picker-count {
  color: var(--pb-text-muted);
  font-family: var(--pb-font-body);
  font-size: 0.85rem;
}

.picker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  gap: 0.5rem;
  max-height: 22rem;
  margin: 0.6rem 0 0;
  padding: 0.25rem;
  list-style: none;
  overflow-y: auto;
}

.picker-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  width: 100%;
  padding: 0.3rem;
  border-radius: var(--pb-radius-sm);
  border: 2px solid transparent;
  background: var(--pb-input-bg);
  color: var(--pb-text);
  text-align: left;
}

.picker-card[aria-pressed='true'] {
  border-color: var(--pb-ring);
  background: color-mix(in srgb, var(--pb-ring) 18%, transparent);
}

.picker-card:disabled {
  opacity: 0.4;
}

.picker-card img {
  width: 100%;
  aspect-ratio: 63 / 88;
  object-fit: cover;
  border-radius: 4px;
}

.picker-name {
  overflow: hidden;
  font-size: 0.7rem;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-qty {
  position: absolute;
  top: 0.4rem;
  right: 0.4rem;
  padding: 0 0.35rem;
  border-radius: 999px;
  background: rgba(10, 13, 26, 0.85);
  color: #fff;
  font-size: 0.65rem;
  font-weight: 800;
}

.composer-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding-top: 1rem;
  border-top: 1px solid var(--pb-border);
}

.composer-summary-text {
  flex: 1 1 16rem;
  margin: 0;
  font-weight: 600;
  font-size: 0.9rem;
}

/* ---------- History ---------- */

.history-rows {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin: 0.75rem 0 0;
  padding: 0;
  list-style: none;
}

.history-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 0.8rem;
  border-radius: var(--pb-radius-sm);
  border: 1px solid var(--pb-border);
  font-size: 0.85rem;
}

.history-text {
  flex: 1;
  min-width: 0;
}

.history-status {
  flex-shrink: 0;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  border: 1px solid var(--pb-border-strong);
  font-size: 0.68rem;
  font-weight: 800;
  text-transform: uppercase;
}

.history-status[data-status='accepted'] {
  border-color: transparent;
  background: var(--pb-success-bg);
  color: var(--pb-success-text);
}

.history-status[data-status='failed'] {
  border-color: transparent;
  background: var(--pb-danger-bg);
  color: var(--pb-danger-text);
}

.trades-back {
  align-self: flex-start;
  font-weight: 700;
}

@media (min-width: 992px) {
  .composer-pickers {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .composer-summary {
    grid-column: 1 / -1;
  }
}
</style>
