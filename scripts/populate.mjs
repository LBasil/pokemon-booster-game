// One-off admin script to seed `sets` and `cards` from the pokemontcg.io API.
// Never bundled into the client app — run manually with:
//   npm run populate:sets
//   npm run populate:cards   (also records today's prices in card_price_history)
//   npm run populate:sync    (sets + cards: the GitHub Action runs this at midnight and noon)
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
import { cardPriceEur, DEFAULT_USD_TO_EUR } from '../src/utils/cardPrice.js'

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Fetches one page and returns its `data` array, or null once the API has
// no more pages. pokemontcg.io's free tier is flaky under load (transient
// 5xx, or an out-of-range page answered with a non-JSON/empty body instead
// of `{ data: [] }`) — retried with backoff before being treated as "no
// more data".
async function fetchPage(endpoint, page) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await fetch(`${endpoint}?page=${page}&pageSize=${PAGE_SIZE}`, { headers })

    if (response.ok) {
      try {
        const { data } = await response.json()
        return data && data.length > 0 ? data : null
      } catch {
        console.warn(`Page ${page}: could not parse response as JSON (attempt ${attempt}/${MAX_ATTEMPTS}).`)
      }
    } else {
      console.warn(`Page ${page}: request failed with status ${response.status} (attempt ${attempt}/${MAX_ATTEMPTS}).`)
    }

    if (attempt < MAX_ATTEMPTS) await sleep(attempt * 1000)
  }

  console.warn(`Page ${page}: giving up after ${MAX_ATTEMPTS} attempts, stopping.`)
  return null
}

async function populateSets() {
  let page = 1

  while (true) {
    const data = await fetchPage(`${BASE_URL}/sets`, page)
    if (!data) break

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
    if (error) {
      console.error('Error inserting sets:', error.message)
      return
    }

    console.log(`Sets page ${page} done (${sets.length} sets)`)
    if (data.length < PAGE_SIZE) break
    page++
  }

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
// cards.attacks / resistances and sets.series (PvP, 0024). Until one is
// applied, rows are saved without it rather than not at all
const OPTIONAL_COLUMNS = {
  cards: { weaknesses: '0015', evolves_from: '0018', attacks: '0024', resistances: '0024' },
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
  let page = startPage

  while (true) {
    const data = await fetchPage(`${BASE_URL}/cards`, page)
    if (!data) break

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
      // PvP (0024): name + damage as printed ("30", "30+", "20×", "" = effect only)
      attacks: card.attacks?.map((attack) => ({ name: attack.name, damage: attack.damage ?? '' })) ?? null,
      resistances: card.resistances?.map((resistance) => resistance.type) ?? null,
      set_id: card.set.id,
    }))

    const { error } = await upsertRows('cards', cards)
    if (error) {
      console.error('Error inserting cards:', error.message)
      return
    }
    await recordPrices(cards)

    console.log(`Cards page ${page} done (${cards.length} cards)`)

    if (data.length < PAGE_SIZE) break
    page++
    await sleep(300)
  }

  console.log('Cards populated.')
}

// Subsets (Trainer Gallery, Shiny Vault...) come inside their parent set's
// packs (migration 0010): link the new ones once their cards are in
async function linkSubsets() {
  const { data, error } = await supabase.rpc('link_subsets')
  if (error) console.warn('Skipping subset linking (run migration 0010 first?):', error.message)
  else console.log(`Subsets linked: ${data}`)
}

const target = process.argv[2]
const startPage = Number(process.argv[3]) || 1

if (target === 'sets') {
  await populateSets()
} else if (target === 'cards') {
  await populateCards(startPage)
  await linkSubsets()
} else if (target === 'sync') {
  // Twice-daily refresh (see .github/workflows/sync-cards.yml): new sets, new
  // cards, fresh prices, a price-history snapshot and new subsets linked
  await populateSets()
  await populateCards(startPage)
  await linkSubsets()
} else {
  console.error('Usage: node scripts/populate.mjs <sets|cards|sync> [startPage]')
  process.exit(1)
}
