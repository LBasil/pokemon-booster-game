<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { fetchChallengeCollectionOf } from '@/api/challenge'
import { fetchPublicProfile } from '@/api/profiles'
import { fetchLeaderboard } from '@/api/social'
import { useAuthStore } from '@/stores/auth'
import { useChallengeCollectionStore } from '@/stores/collection'
import { useProfileStore } from '@/stores/profile'
import { useTradesStore } from '@/stores/trades'
import { rarityTier } from '@/utils/rarity'
import { timeAgo } from '@/utils/time'
import { TRADE_MAX_CARDS, searchEntries, toggleCard } from '@/utils/trades'
import AppHeader from '@/components/AppHeader.vue'
import UsernameCombobox from '@/components/UsernameCombobox.vue'

// Trades between players (challenge mode): answer offers, follow the ones
// you sent, and build a new one (?to=<username> prefills the partner, e.g.
// from a public profile, ?want=<card id> one of their cards, ?give=<card
// id> one of mine, e.g. from a card's detail). The server checks and swaps
// the cards. Answers to my offers I hadn't seen (migration 0017) come first,
// then count as seen: the badge clears. "Counter" on a received offer
// (migration 0021) loads it into the composer, sides swapped, to send back
// changed: the first offer ends as "countered".
const { t, locale } = useI18n()
const route = useRoute()
const trades = useTradesStore()
const myCollection = useChallengeCollectionStore()

const profileStore = useProfileStore()
const auth = useAuthStore()

onMounted(() => {
  trades.load({ force: true })
  trades.loadLocks()
  myCollection.load()
  profileStore.load()
  loadSuggestions()
})

// A new player knows nobody: suggest the public trainers with the biggest
// challenge collections (the "Most cards" board), the ones most likely to
// have something to swap. Failures just leave the field on its own.
const SUGGESTED_TRAINERS = 6
const boardNames = ref([])
async function loadSuggestions() {
  try {
    boardNames.value = (await fetchLeaderboard('challenge_unique', SUGGESTED_TRAINERS + 1)).map((row) => row.username)
  } catch {
    boardNames.value = []
  }
}
// Never myself; reactive, as my profile may load after the board
const suggestions = computed(() => {
  const me = profileStore.profile?.username?.toLowerCase()
  if (!me) return []
  return boardNames.value.filter((name) => name.toLowerCase() !== me).slice(0, SUGGESTED_TRAINERS)
})
function pickSuggestion(name) {
  partnerName.value = name
  findPartner()
}

// ---------- Trade preferences (migration 0012) ----------

const acceptsTrades = computed(() => profileStore.profile?.accepts_trades !== false)
const prefBusy = ref(false)
async function setAcceptsTrades(value) {
  prefBusy.value = true
  try {
    await profileStore.update({ accepts_trades: value })
  } catch (err) {
    showError(err)
  } finally {
    prefBusy.value = false
  }
}

// My cards kept out of trades, named when they're in the collection
const lockedCards = computed(() =>
  trades.locks.map((id) => ({ id, name: myCollection.entries.find((entry) => entry.card_id === id)?.cards.name ?? id })),
)
const unlock = (cardId) => trades.toggleLock(cardId).catch(showError)

const firstLoad = computed(() => !trades.loaded && !trades.error)

// Answers new on this visit: kept on top until the page is left, even once
// the server has them as seen (a live reload clears `unseen`)
const freshIds = ref(new Set())
watch(
  () => trades.trades,
  (list) => {
    const fresh = list.filter((trade) => trade.unseen)
    if (!fresh.length) return
    freshIds.value = new Set([...freshIds.value, ...fresh.map((trade) => trade.id)])
    trades.markSeen()
  },
  { immediate: true },
)
const answers = computed(() => trades.trades.filter((trade) => freshIds.value.has(trade.id)))
const groups = computed(() => {
  const { received, sent, history } = trades.groups
  return { received, sent, history: history.filter((trade) => !freshIds.value.has(trade.id)) }
})

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
const partnerState = ref('idle') // idle | loading | empty | closed (refuses trades) | error
const giving = ref([]) // my card ids
const asking = ref([]) // partner card ids
const giveQuery = ref('')
const askQuery = ref('')
const sending = ref(false)

// The received offer being answered with a counter-offer (migration 0021)
const countering = ref(null)
const composerEl = ref(null)

async function findPartner() {
  const name = partnerName.value.trim()
  if (!name) return
  // Another trainer: a new offer, not a counter-offer any more
  if (countering.value && name.toLowerCase() !== countering.value.partner.toLowerCase()) countering.value = null
  partnerState.value = 'loading'
  partner.value = null
  asking.value = []
  errorMessage.value = ''
  try {
    const [entries, profile] = await Promise.all([fetchChallengeCollectionOf(name), fetchPublicProfile(name).catch(() => null)])
    partner.value = { username: profile?.username ?? name, entries }
    // They made the first offer: a counter-offer ignores their "accepts trades"
    if (profile && profile.accepts_trades === false && !countering.value) {
      partnerState.value = 'closed'
      return
    }
    partnerState.value = entries.length ? 'idle' : 'empty'
    // ?want=<card id> (a public profile's "Ask for it"): already picked
    const wanted = route.query.want
    if (typeof wanted === 'string' && entries.some((entry) => entry.card_id === wanted && entry.tradable !== false)) asking.value = [wanted]
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

// Pickers show 60 matches, then 60 more per "Show more" (a new search or
// partner starts over)
const PICKER_PAGE = 60
const giveLimit = ref(PICKER_PAGE)
const askLimit = ref(PICKER_PAGE)
watch(giveQuery, () => (giveLimit.value = PICKER_PAGE))
watch([askQuery, partner], () => (askLimit.value = PICKER_PAGE))
const giveMatches = computed(() => searchEntries(myCollection.entries, giveQuery.value))
const askMatches = computed(() => searchEntries(partner.value?.entries ?? [], askQuery.value))
const giveOptions = computed(() => giveMatches.value.slice(0, giveLimit.value))
const askOptions = computed(() => askMatches.value.slice(0, askLimit.value))

// How many copies of each card I own (challenge collection), shown on both
// pickers: don't give away a last copy, don't ask for one you already have
const ownedQty = computed(() => {
  const map = {}
  for (const entry of myCollection.entries) map[entry.card_id] = entry.quantity
  return map
})
const ownedLabel = (cardId) => t('trades.owned', { count: ownedQty.value[cardId] ?? 0 }, ownedQty.value[cardId] ?? 0)

const cardById = computed(() => {
  const map = {}
  for (const entry of [...myCollection.entries, ...(partner.value?.entries ?? [])]) map[entry.card_id] = entry.cards
  return map
})

// ?give=<card id> (a card's detail, "Propose in a trade"): already picked,
// once my collection says I have it
watch(
  () => [route.query.give, myCollection.entries],
  ([give]) => {
    if (typeof give !== 'string' || giving.value.includes(give)) return
    if (myCollection.entries.some((entry) => entry.card_id === give) && !trades.isLocked(give)) giving.value = toggleCard(giving.value, give)
  },
  { immediate: true },
)

/** Their offer in the composer, sides swapped: what they asked for, what they offered. */
async function startCounter(trade) {
  countering.value = trade
  notice.value = ''
  partnerName.value = trade.partner
  giveQuery.value = ''
  askQuery.value = ''
  await findPartner()
  if (countering.value !== trade) return
  const mine = new Set(myCollection.entries.map((entry) => entry.card_id))
  giving.value = trade.request.map((card) => card.id).filter((id) => mine.has(id) && !trades.isLocked(id))
  const theirs = new Set((partner.value?.entries ?? []).filter((entry) => entry.tradable !== false).map((entry) => entry.card_id))
  asking.value = trade.offer.map((card) => card.id).filter((id) => theirs.has(id))
  await nextTick()
  composerEl.value?.scrollIntoView({ block: 'start' })
}

function stopCounter() {
  countering.value = null
}

// An answered or expired offer can't be countered any more
watch(
  () => trades.groups.received,
  (received) => {
    if (countering.value && !received.some((trade) => trade.id === countering.value.id)) countering.value = null
  },
)

const canSend = computed(() => partner.value && giving.value.length > 0 && !sending.value)

async function send() {
  if (!canSend.value) return
  sending.value = true
  notice.value = ''
  errorMessage.value = ''
  try {
    if (countering.value) {
      await trades.counter(countering.value.id, giving.value, asking.value)
      notice.value = t('trades.counterSent', { name: partner.value.username })
      countering.value = null
    } else {
      await trades.propose(partner.value.username, giving.value, asking.value)
      notice.value = t('trades.sentNotice', { name: partner.value.username })
    }
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
        <!-- ============ Answers to my offers (new) ============ -->
        <section v-if="answers.length" aria-labelledby="trades-answers">
          <h2 id="trades-answers" class="pb-section-title">
            {{ t('trades.answers') }} <span class="trades-count">{{ answers.length }}</span>
          </h2>
          <ul class="trades-list" role="list">
            <li v-for="trade in answers" :key="trade.id" class="trade trade-answer" :data-status="trade.status">
              <p class="trade-head">
                <span class="trade-answer-text">
                  <span class="history-status" :data-status="trade.status">{{ statusLabel(trade.status) }}</span>
                  <i18n-t :keypath="`trades.answer.${trade.status}`" tag="span" scope="global">
                    <template #name>
                      <RouterLink :to="{ name: 'public-profile', params: { username: trade.partner } }" class="trade-partner">{{ trade.partner }}</RouterLink>
                    </template>
                  </i18n-t>
                </span>
                <span class="trade-time">{{ ago(trade.resolved_at ?? trade.created_at) }}</span>
              </p>
              <div class="trade-sides">
                <div class="trade-side">
                  <span class="trade-side-label">{{ trade.status === 'accepted' ? t('trades.youGave') : t('trades.youOffered') }}</span>
                  <ul class="trade-cards" role="list">
                    <li v-for="card in trade.offer" :key="card.id" :data-tier="rarityTier(card)">
                      <img :src="card.image_small" :alt="card.name" :title="card.name" loading="lazy" />
                    </li>
                  </ul>
                </div>
                <span class="trade-arrow" aria-hidden="true">⇄</span>
                <div class="trade-side">
                  <span class="trade-side-label">{{ trade.status === 'accepted' ? t('trades.youGot') : t('trades.youAsked') }}</span>
                  <ul v-if="trade.request.length" class="trade-cards" role="list">
                    <li v-for="card in trade.request" :key="card.id" :data-tier="rarityTier(card)">
                      <img :src="card.image_small" :alt="card.name" :title="card.name" loading="lazy" />
                    </li>
                  </ul>
                  <p v-else class="trade-gift">{{ t('trades.gift') }}</p>
                </div>
              </div>
            </li>
          </ul>
        </section>

        <!-- ============ Received ============ -->
        <section v-if="groups.received.length" aria-labelledby="trades-received">
          <h2 id="trades-received" class="pb-section-title">
            {{ t('trades.received') }} <span class="trades-count">{{ groups.received.length }}</span>
          </h2>
          <ul class="trades-list" role="list">
            <li v-for="trade in groups.received" :key="trade.id" class="trade" :class="{ 'is-countering': countering?.id === trade.id }">
              <p class="trade-head">
                <span>
                  <RouterLink :to="{ name: 'public-profile', params: { username: trade.partner } }" class="trade-partner">{{ trade.partner }}</RouterLink>
                  <span v-if="trade.counter_of" class="trade-tag">{{ t('trades.counterTag') }}</span>
                </span>
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
                <button
                  type="button"
                  class="btn btn-outline-secondary btn-sm"
                  :disabled="busyId === trade.id || countering?.id === trade.id"
                  @click="startCounter(trade)"
                >
                  {{ t('trades.counter') }}
                </button>
              </div>
            </li>
          </ul>
        </section>

        <!-- ============ New offer ============ -->
        <section ref="composerEl" class="composer" aria-labelledby="trades-new">
          <h2 id="trades-new" class="pb-section-title">
            {{ countering ? t('trades.counterTitle', { name: countering.partner }) : t('trades.newTitle') }}
          </h2>

          <div v-if="countering" class="composer-counter">
            <p class="composer-counter-text">{{ t('trades.counterHint', { name: countering.partner }) }}</p>
            <button type="button" class="btn btn-outline-secondary btn-sm" @click="stopCounter">{{ t('trades.counterStop') }}</button>
          </div>

          <!-- Nothing to give yet: say so before the player picks a partner -->
          <div v-if="!countering && myCollection.loaded && !myCollection.entries.length" class="composer-empty">
            <p>{{ t('trades.noCardsYet') }}</p>
            <RouterLink :to="{ name: 'challenge-boosters' }" class="btn btn-primary btn-sm">{{ t('trades.openFirst') }}</RouterLink>
          </div>

          <!-- What others may ask me for (migration 0012) -->
          <div v-if="!countering" class="trade-prefs">
            <label class="trade-pref form-switch">
              <span>
                <span id="accept-trades-title" class="trade-pref-title">{{ t('trades.acceptLabel') }}</span>
                <span id="accept-trades-desc" class="trade-pref-desc">{{ acceptsTrades ? t('trades.acceptOn') : t('trades.acceptOff') }}</span>
              </span>
              <input
                type="checkbox"
                class="form-check-input pb-switch"
                role="switch"
                aria-labelledby="accept-trades-title"
                aria-describedby="accept-trades-desc"
                :checked="acceptsTrades"
                :disabled="prefBusy || !profileStore.profile"
                @change="setAcceptsTrades($event.target.checked)"
              />
            </label>
            <div class="trade-locks">
              <p class="trade-pref-title">{{ t('trades.locksTitle', { count: lockedCards.length }, lockedCards.length) }}</p>
              <p class="trade-pref-desc">{{ t('trades.locksHint') }}</p>
              <ul v-if="lockedCards.length" class="trade-lock-list" role="list">
                <li v-for="card in lockedCards" :key="card.id" class="trade-lock">
                  <span>{{ card.name }}</span>
                  <button
                    type="button"
                    class="trade-lock-remove"
                    :aria-label="t('trades.unlock', { name: card.name })"
                    :title="t('trades.unlock', { name: card.name })"
                    @click="unlock(card.id)"
                  >
                    ×
                  </button>
                </li>
              </ul>
            </div>
          </div>

          <form v-if="!countering" class="composer-find" @submit.prevent="findPartner">
            <label for="trade-partner" class="form-label">{{ t('trades.partnerLabel') }}</label>
            <div class="composer-find-row">
              <UsernameCombobox
                id="trade-partner"
                v-model="partnerName"
                :placeholder="t('trades.partnerPlaceholder')"
                :exclude-id="auth.user?.id"
                @pick="findPartner"
              />
              <button type="submit" class="btn btn-outline-secondary" :disabled="!partnerName.trim() || partnerState === 'loading'">
                {{ t('trades.find') }}
              </button>
            </div>
            <div v-if="suggestions.length && !partner && partnerState !== 'loading'" class="composer-suggest">
              <span id="trade-suggest-label" class="composer-suggest-label">{{ t('trades.suggestTitle') }}</span>
              <ul class="composer-suggest-list" role="list" aria-labelledby="trade-suggest-label">
                <li v-for="name in suggestions" :key="name">
                  <button type="button" class="composer-suggest-chip" @click="pickSuggestion(name)">{{ name }}</button>
                </li>
              </ul>
            </div>
            <p v-if="partnerState === 'empty'" class="composer-hint">{{ t('trades.partnerEmpty', { name: partnerName.trim() }) }}</p>
            <p v-if="partnerState === 'closed'" class="composer-hint">{{ t('trades.partnerClosed', { name: partner.username }) }}</p>
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
                    :disabled="trades.isLocked(entry.card_id) || (!giving.includes(entry.card_id) && giving.length >= TRADE_MAX_CARDS)"
                    @click="giving = toggleCard(giving, entry.card_id)"
                  >
                    <img :src="entry.cards.image_small" alt="" loading="lazy" />
                    <span class="picker-name">{{ entry.cards.name }}</span>
                    <span class="picker-owned">{{ ownedLabel(entry.card_id) }}</span>
                    <span v-if="trades.isLocked(entry.card_id)" class="picker-locked">{{ t('trades.notForTrade') }}</span>
                  </button>
                </li>
              </ul>
              <button v-if="giveMatches.length > giveOptions.length" type="button" class="btn btn-outline-secondary btn-sm picker-more" @click="giveLimit += PICKER_PAGE">
                {{ t('trades.showMore', { count: giveMatches.length - giveOptions.length }) }}
              </button>
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
                    :disabled="entry.tradable === false || (!asking.includes(entry.card_id) && asking.length >= TRADE_MAX_CARDS)"
                    @click="asking = toggleCard(asking, entry.card_id)"
                  >
                    <img :src="entry.cards.image_small" alt="" loading="lazy" />
                    <span class="picker-name">{{ entry.cards.name }}</span>
                    <span class="picker-owned" :data-new="!ownedQty[entry.card_id] || undefined">{{ ownedLabel(entry.card_id) }}</span>
                    <span v-if="entry.tradable === false" class="picker-locked">{{ t('trades.notForTrade') }}</span>
                  </button>
                </li>
              </ul>
              <button v-if="askMatches.length > askOptions.length" type="button" class="btn btn-outline-secondary btn-sm picker-more" @click="askLimit += PICKER_PAGE">
                {{ t('trades.showMore', { count: askMatches.length - askOptions.length }) }}
              </button>
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
                {{ countering ? t('trades.counterSend', { name: partner.username }) : t('trades.send', { name: partner.username }) }}
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
                <span>
                  {{ t('trades.to') }} <RouterLink :to="{ name: 'public-profile', params: { username: trade.partner } }" class="trade-partner">{{ trade.partner }}</RouterLink>
                  <span v-if="trade.counter_of" class="trade-tag">{{ t('trades.counterTag') }}</span>
                </span>
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
                <template v-if="trade.counter_of">{{ t('trades.counterTag') }} ·</template>
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

.trade.is-countering {
  border-color: var(--pb-border-strong);
  box-shadow: 0 0 0 2px var(--pb-ring);
}

.trade-tag {
  display: inline-block;
  margin-left: 0.4rem;
  padding: 0.05rem 0.45rem;
  border-radius: 999px;
  border: 1px solid var(--pb-border-strong);
  color: var(--pb-text-muted);
  font-size: 0.68rem;
  font-weight: 800;
  text-transform: uppercase;
  vertical-align: 0.1em;
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
  scroll-margin-top: 5rem;
}

.trade-prefs {
  display: grid;
  gap: 0.9rem;
  margin-bottom: 1.25rem;
  padding: 0.9rem 1rem;
  border-radius: var(--pb-radius-md);
  border: 1px solid var(--pb-border);
  background: var(--pb-input-bg);
}

.trade-pref {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding-left: 0;
  cursor: pointer;
}

.trade-pref > span {
  display: flex;
  flex-direction: column;
}

.trade-pref-title {
  margin: 0;
  font-weight: 700;
}

.trade-pref-desc {
  margin: 0;
  font-size: 0.85rem;
  color: var(--pb-text-muted);
}

.trade-lock-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin: 0.6rem 0 0;
  padding: 0;
  list-style: none;
}

.trade-lock {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.2rem 0.3rem 0.2rem 0.7rem;
  border-radius: 999px;
  border: 1px solid var(--pb-border-strong);
  background: var(--pb-surface);
  font-size: 0.8rem;
  font-weight: 700;
}

.trade-lock-remove {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 50%;
  background: var(--pb-selected);
  color: var(--pb-text);
  line-height: 1;
}

.picker-locked {
  position: absolute;
  left: 4px;
  right: 4px;
  bottom: 38px;
  padding: 0.1rem 0.3rem;
  border-radius: 999px;
  background: var(--pb-text);
  color: var(--pb-bg);
  font-size: 0.6rem;
  font-weight: 800;
  text-align: center;
}

.composer-counter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem 1rem;
  margin-top: 0.75rem;
  padding: 0.75rem 1rem;
  border-radius: var(--pb-radius-sm);
  border: 1px solid var(--pb-border-strong);
  background: var(--pb-selected);
}

.composer-counter-text {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 600;
}

.picker-more {
  margin-top: 0.5rem;
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

.composer-empty {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem 1rem;
  margin-bottom: 1rem;
  padding: 0.75rem 0.75rem 0.75rem 1rem;
  border-radius: var(--pb-radius-md);
  border: 1px solid color-mix(in srgb, var(--pb-accent) 45%, transparent);
  background: color-mix(in srgb, var(--pb-accent) 12%, var(--pb-bg-elevated));
  font-weight: 700;
}

.composer-empty p {
  margin: 0;
}

.composer-suggest {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-top: 0.75rem;
}

.composer-suggest-label {
  color: var(--pb-text-muted);
  font-size: 0.85rem;
  font-weight: 700;
}

.composer-suggest-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.composer-suggest-chip {
  min-height: 36px;
  padding: 0.3rem 0.8rem;
  border-radius: 999px;
  border: 1px solid var(--pb-border-strong);
  background: var(--pb-surface);
  color: var(--pb-text);
  font-weight: 700;
  font-size: 0.9rem;
}

@media (hover: hover) {
  .composer-suggest-chip:hover {
    border-color: var(--pb-ring);
  }
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

.picker-owned {
  overflow: hidden;
  color: var(--pb-text-muted);
  font-size: 0.65rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-owned[data-new] {
  color: var(--pb-success-text);
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

/* ---------- Answers to my offers ---------- */

.trade-answer[data-status='accepted'] {
  border-color: color-mix(in srgb, var(--pb-success-text) 45%, var(--pb-border));
}

.trade-answer-text {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  font-weight: 600;
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
