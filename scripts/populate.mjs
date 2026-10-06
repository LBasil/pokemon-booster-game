// One-off admin script to seed `sets` and `cards` from the pokemontcg.io API.
// Never bundled into the client app — run manually with:
//   npm run populate:sets
//   npm run populate:cards   (also records today's prices in card_price_history)
//   npm run populate:fr      (French names, images and texts from TCGdex, migration 0029;
//                             `fr --rematch` retries the sets TCGdex had no match for)
//   npm run populate:sync    (sets + cards + fr: the GitHub Action runs this at midnight and noon)
//
// Requires scripts/.env.local (gitignored) with:
//   SUPABASE_URL=...
//   SUPABASE_SERVICE_ROLE_KEY=...   (bypasses RLS for bulk writes — admin-only, never expose client-side)
//   POKEMONTCG_API_KEY=...
//   USD_TO_EUR=0.86                 (optional: rate for cards priced on TCGplayer only)

import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { parseAttack } from '../src/utils/attackEffects.js'
import { trainerData } from '../src/utils/trainerEffects.js'
import { abilityData } from '../src/utils/abilityEffects.js'
import { cardPriceEur, DEFAULT_USD_TO_EUR } from '../src/utils/cardPrice.js'
import { matchSet, normalizeNumber, numberOfId } from '../src/utils/tcgdex.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.join(__dirname, '.env.local') })

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, POKEMONTCG_API_KEY } = process.env
const USD_TO_EUR = Number(process.env.USD_TO_EUR) || DEFAULT_USD_TO_EUR

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in scripts/.env.local')
  process.exit(1)
}
if (!POKEMONTCG_API_KEY) {
  console.error('Missing POKEMONTCG_API_KEY in scripts/.env.local')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const BASE_URL = 'https://api.pokemontcg.io/v2'
const headers = { 'X-Api-Key': POKEMONTCG_API_KEY }
const PAGE_SIZE = 250
const MAX_ATTEMPTS = 6
// pokemontcg.io: on 2026-10-06 ~60% of its answers were an instant 500 / 502,
// whatever the page; with 6 attempts a page failed them all 1 time in 20, so
// a run of 83 pages nearly always lost one (and its single retry at the end
// failed as often). The errors come back in ~0.2 s: attempts are cheap.
const API_ATTEMPTS = 15
const RETRY_ROUNDS = 3

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Fetches one page: `{ data, totalCount }`, or null if it still fails after
// API_ATTEMPTS. pokemontcg.io's free tier is flaky under load (transient
// 5xx, non-JSON bodies, dropped connections), hence the retries with backoff
// (capped at 15 s, with jitter so retries don't line up with its bad patches).
async function fetchPage(endpoint, page) {
  for (let attempt = 1; attempt <= API_ATTEMPTS; attempt++) {
    const response = await fetch(`${endpoint}?page=${page}&pageSize=${PAGE_SIZE}`, { headers }).catch((err) => err)

    if (response instanceof Error) {
      console.warn(`Page ${page}: ${response.message} (attempt ${attempt}/${API_ATTEMPTS}).`)
    } else if (response.ok) {
      try {
        const { data, totalCount } = await response.json()
        if (Array.isArray(data)) return { data, totalCount }
        console.warn(`Page ${page}: no data in the response (attempt ${attempt}/${API_ATTEMPTS}).`)
      } catch {
        console.warn(`Page ${page}: could not parse response as JSON (attempt ${attempt}/${API_ATTEMPTS}).`)
      }
    } else {
      console.warn(`Page ${page}: request failed with status ${response.status} (attempt ${attempt}/${API_ATTEMPTS}).`)
    }

    if (attempt < API_ATTEMPTS) await sleep(Math.min(attempt * 2000, 15000) + Math.random() * 1000)
  }

  console.warn(`Page ${page}: giving up after ${API_ATTEMPTS} attempts.`)
  return null
}

// Runs `save(data, page)` on every page of an endpoint, from `startPage` to
// the last one (from the API's totalCount). A page that kept failing used to
// end the import right there, as if it were the last, and the run still
// "succeeded": on 2026-10-04 ~7,400 cards were left with their attacks
// imported before 0025, without a cost (free attacks in PvP). Now that page
// is skipped, retried at the end (RETRY_ROUNDS rounds, 30 s apart), and if
// it still fails the script exits with an error (the GitHub Action shows red).
async function forEachPage(endpoint, startPage, save) {
  const failed = []
  let lastPage = Infinity

  const run = async (page) => {
    const result = await fetchPage(endpoint, page)
    if (!result) return false
    if (Number.isFinite(result.totalCount)) lastPage = Math.max(1, Math.ceil(result.totalCount / PAGE_SIZE))
    if (result.data.length) await save(result.data, page)
    // No totalCount in the answer: an empty page is the end
    else if (lastPage === Infinity) lastPage = page
    return true
  }

  for (let page = startPage; page <= lastPage; page++) {
    if (!(await run(page))) {
      // Without one good page, the number of pages is unknown
      if (lastPage === Infinity) throw new Error(`${endpoint}: page ${page} failed, import stopped.`)
      failed.push(page)
    }
    await sleep(300)
  }

  let stillFailed = failed
  for (let round = 1; round <= RETRY_ROUNDS && stillFailed.length; round++) {
    console.warn(`${endpoint}: retrying page(s) ${stillFailed.join(', ')} (round ${round}/${RETRY_ROUNDS}).`)
    const pages = stillFailed
    stillFailed = []
    for (const page of pages) {
      await sleep(30000)
      if (!(await run(page))) stillFailed.push(page)
    }
  }
  if (stillFailed.length) {
    console.error(`${endpoint}: page(s) ${stillFailed.join(', ')} could not be imported.`)
    process.exitCode = 1
  }
}

async function populateSets() {
  await forEachPage(`${BASE_URL}/sets`, 1, async (data, page) => {
    const sets = data.map((set) => ({
      id: set.id,
      name: set.name,
      release_date: set.releaseDate,
      printed_total: set.printedTotal,
      total: set.total,
      // New sets' images live on images.scrydex.com, so store what the API gives
      logo_url: set.images?.logo ?? null,
      symbol_url: set.images?.symbol ?? null,
      // The TCG era (Base, Neo, ... Scarlet & Violet): PvP's era format (0024)
      series: set.series ?? null,
    }))

    const { error } = await upsertRows('sets', sets)
    if (error) throw new Error(`Error inserting sets: ${error.message}`)
    console.log(`Sets page ${page} done (${sets.length} sets)`)
  })

  console.log('Sets populated.')
}

// One Cardmarket price snapshot per card per day (card_price_history,
// migration 0004): each day's import draws a point of the price curve.
const today = new Date().toISOString().slice(0, 10)
let priceHistoryAvailable = true

async function recordPrices(cards) {
  if (!priceHistoryAvailable) return
  const rows = cards.filter((card) => card.value > 0).map((card) => ({ card_id: card.id, recorded_on: today, value: card.value }))
  if (!rows.length) return
  const { error } = await supabase.from('card_price_history').upsert(rows, { onConflict: 'card_id,recorded_on' })
  if (error) {
    priceHistoryAvailable = false
    console.warn('Skipping price history (run migration 0004 first?):', error.message)
  }
}

// Columns that came with later migrations: cards.weaknesses ("Super
// effective!", 0015), cards.evolves_from ("Evolution chain", 0018),
// cards.attacks / resistances and sets.series (PvP, 0024), retreat costs
// and abilities (Pocket-style PvP, 0029), Trainers' effects (0032). Until one is applied, rows are
// saved without it rather than not at all
const OPTIONAL_COLUMNS = {
  cards: {
    weaknesses: '0015',
    evolves_from: '0018',
    attacks: '0024',
    resistances: '0024',
    retreat_cost: '0029',
    abilities: '0029',
    trainer: '0032',
  },
  sets: { series: '0024' },
}
const missingColumns = { cards: new Set(), sets: new Set() }

async function upsertRows(table, rows) {
  const missing = missingColumns[table]
  const kept = missing.size
    ? rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !missing.has(key))))
    : rows
  const { error } = await supabase.from(table).upsert(kept)
  const column = error && Object.keys(OPTIONAL_COLUMNS[table]).find((key) => !missing.has(key) && error.message.includes(key))
  if (column) {
    missing.add(column)
    console.warn(`Skipping ${table}.${column} (run migration ${OPTIONAL_COLUMNS[table][column]} first?):`, error.message)
    return upsertRows(table, rows)
  }
  return { error }
}

async function populateCards(startPage = 1) {
  await forEachPage(`${BASE_URL}/cards`, startPage, async (data, page) => {
    const cards = data.map((card) => ({
      id: card.id,
      name: card.name,
      rarity: card.rarity ?? null,
      value: cardPriceEur(card, USD_TO_EUR),
      image_url: card.images.large,
      image_small: card.images.small,
      artist: card.artist ?? null,
      national_pokedex_number: card.nationalPokedexNumbers?.[0] ?? null,
      supertype: card.supertype,
      subtypes: card.subtypes ?? null,
      hp: card.hp ?? null,
      types: card.types ?? null,
      weaknesses: card.weaknesses?.map((weakness) => weakness.type) ?? null,
      evolves_from: card.evolvesFrom ?? null,
      // PvP (0024): name, damage as printed ("30", "30+", "20×", "" = effect
      // only); cost (number of energies) since 0025; since 0029 the printed
      // text and what the battles apply of it (src/utils/attackEffects.js:
      // base damage, effects, coins, partial = some text isn't applied);
      // since 0031 the typed cost (energy: ['Fire', 'Colorless'])
      attacks:
        card.attacks?.map((attack) => {
          const { damage: base, fx, coins, partial } = parseAttack(attack)
          return {
            name: attack.name,
            damage: attack.damage ?? '',
            base,
            cost: attack.convertedEnergyCost ?? attack.cost?.length ?? 0,
            energy: (attack.cost ?? []).filter((type) => type !== 'Free'),
            text: attack.text ?? '',
            fx,
            coins,
            partial,
          }
        }) ?? null,
      retreat_cost: card.convertedRetreatCost ?? card.retreatCost?.length ?? 0,
      // what the battles play of each ability (0033): kind, fx, playable...
      abilities: card.abilities?.map((ability) => abilityData(ability, card.name)) ?? null,
      resistances: card.resistances?.map((resistance) => resistance.type) ?? null,
      // PvP Trainers (0032): what src/utils/trainerEffects.js reads in the text
      trainer: card.supertype === 'Trainer' ? trainerData(card) : null,
      set_id: card.set.id,
    }))

    const { error } = await upsertRows('cards', cards)
    if (error) throw new Error(`Error inserting cards: ${error.message}`)
    await recordPrices(cards)

    console.log(`Cards page ${page} done (${cards.length} cards)`)
  })

  console.log('Cards populated.')
}

// Subsets (Trainer Gallery, Shiny Vault...) come inside their parent set's
// packs (migration 0010): link the new ones once their cards are in
async function linkSubsets() {
  const { data, error } = await supabase.rpc('link_subsets')
  if (error) console.warn('Skipping subset linking (run migration 0010 first?):', error.message)
  else console.log(`Subsets linked: ${data}`)
}

// ---------- French cards (TCGdex, migration 0029) ----------

const TCGDEX = 'https://api.tcgdex.net/v2'

async function fetchJson(url) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await fetch(url).catch((err) => err)
    if (!(response instanceof Error) && response.ok) {
      try {
        return await response.json()
      } catch {
        // retried below
      }
    }
    if (!(response instanceof Error) && response.status === 404) return null
    if (attempt < MAX_ATTEMPTS) await sleep(attempt * 1000)
  }
  console.warn(`${url}: giving up after ${MAX_ATTEMPTS} attempts.`)
  return null
}

// Runs `work` on every item, `limit` at a time
async function pool(items, limit, work) {
  const results = []
  let next = 0
  const run = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await work(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return results
}

async function selectAll(table, columns) {
  const rows = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).order('id').range(from, from + 999)
    if (error) throw error
    rows.push(...data)
    if (data.length < 1000) return rows
  }
}

async function writeCardsFr(rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.rpc('set_cards_fr', { p_rows: rows.slice(i, i + 500) })
    if (error) throw new Error(`set_cards_fr: ${error.message}`)
  }
}

const frTexts = (list) => (list ?? []).map((item) => ({ name: item.name ?? '', effect: item.effect ?? '' }))

async function populateFr({ rematch = false } = {}) {
  let sets
  try {
    sets = await selectAll('sets', 'id, name, tcgdex_id')
  } catch (err) {
    console.warn('Skipping French cards (run migration 0029 first?):', err.message)
    return
  }
  // effect_fr (Trainers' French text) since 0032
  const cards = await selectAll('cards', 'id, name, set_id, supertype, attacks_fr, effect_fr').catch(() =>
    selectAll('cards', 'id, name, set_id, supertype, attacks_fr'),
  )
  const bySet = Map.groupBy(cards, (card) => card.set_id)

  // 1. Sets: match the new ones ('' = checked, no TCGdex set)
  const unmatched = sets.filter((set) => set.tcgdex_id === null || (rematch && set.tcgdex_id === ''))
  if (unmatched.length) {
    const list = await fetchJson(`${TCGDEX}/en/sets`)
    const theirs = list ? await pool(list, 6, (set) => fetchJson(`${TCGDEX}/en/sets/${encodeURIComponent(set.id)}`)) : []
    // "No match" is only recorded when TCGdex answered for every set: a
    // failed request must not hide a set for good
    const complete = list?.length > 0 && theirs.every(Boolean)
    if (!complete) console.warn('TCGdex: some sets could not be read, unmatched sets will be retried next time.')
    let found = 0
    for (const set of unmatched) {
      const id = matchSet(bySet.get(set.id) ?? [], theirs.filter(Boolean))
      if (!id && !complete) continue
      set.tcgdex_id = id ?? ''
      found += Boolean(id)
      const { error } = await supabase.from('sets').update({ tcgdex_id: set.tcgdex_id }).eq('id', set.id)
      if (error) throw new Error(`sets.tcgdex_id: ${error.message}`)
    }
    console.log(`TCGdex sets matched: ${found} / ${unmatched.length}`)
  }

  // 2. French names and images, one request per set
  const frSets = new Map(((await fetchJson(`${TCGDEX}/fr/sets`)) ?? []).map((set) => [set.id, set]))
  const rows = []
  const details = [] // Pokémon whose French attacks / Trainers whose French text aren't stored yet: [our id, TCGdex id, supertype]
  for (const set of sets.filter((s) => s.tcgdex_id && frSets.has(s.tcgdex_id))) {
    const fr = await fetchJson(`${TCGDEX}/fr/sets/${encodeURIComponent(set.tcgdex_id)}`)
    if (!fr) continue
    const { error } = await supabase.from('sets').update({ name_fr: fr.name ?? null }).eq('id', set.id)
    if (error) throw new Error(`sets.name_fr: ${error.message}`)
    const byNumber = new Map((fr.cards ?? []).map((card) => [normalizeNumber(card.localId), card]))
    for (const card of bySet.get(set.id) ?? []) {
      const theirs = byNumber.get(normalizeNumber(numberOfId(card.id)))
      if (!theirs) continue
      rows.push({ id: card.id, name_fr: theirs.name ?? null, image_fr: theirs.image ?? null })
      if (card.supertype === 'Pokémon' && card.attacks_fr === null) details.push([card.id, theirs.id, card.supertype])
      if (card.supertype === 'Trainer' && card.effect_fr === null) details.push([card.id, theirs.id, card.supertype])
    }
  }
  await writeCardsFr(rows)
  console.log(`French names and images: ${rows.length} cards`)

  // 3. French attack and ability texts (Trainers: their effect), one request per new card
  let done = 0
  for (let i = 0; i < details.length; i += 200) {
    const batch = await pool(details.slice(i, i + 200), 6, async ([id, tcgdexId, supertype]) => {
      const card = await fetchJson(`${TCGDEX}/fr/cards/${encodeURIComponent(tcgdexId)}`)
      if (!card) return null
      return supertype === 'Trainer' ? { id, effect_fr: card.effect ?? '' } : { id, attacks_fr: frTexts(card.attacks), abilities_fr: frTexts(card.abilities) }
    })
    const found = batch.filter(Boolean)
    await writeCardsFr(found)
    done += found.length
    console.log(`French attacks and Trainer texts: ${done} / ${details.length}`)
  }
}

const target = process.argv[2]
const startPage = Number(process.argv[3]) || 1

if (target === 'sets') {
  await populateSets()
} else if (target === 'cards') {
  await populateCards(startPage)
  await linkSubsets()
} else if (target === 'fr') {
  await populateFr({ rematch: process.argv.includes('--rematch') })
} else if (target === 'sync') {
  // Twice-daily refresh (see .github/workflows/sync-cards.yml): new sets, new
  // cards, fresh prices, a price-history snapshot, new subsets linked and
  // the French data of new cards
  await populateSets()
  await populateCards(startPage)
  await linkSubsets()
  await populateFr()
} else {
  console.error('Usage: node scripts/populate.mjs <sets|cards|fr|sync> [startPage | --rematch]')
  process.exit(1)
}
