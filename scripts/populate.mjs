// One-off admin script to seed `sets` and `cards` from the pokemontcg.io API.
// Never bundled into the client app — run manually with:
//   npm run populate:sets
//   npm run populate:cards
//
// Requires scripts/.env.local (gitignored) with:
//   SUPABASE_URL=...
//   SUPABASE_SERVICE_ROLE_KEY=...   (bypasses RLS for bulk writes — admin-only, never expose client-side)
//   POKEMONTCG_API_KEY=...

import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.join(__dirname, '.env.local') })

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, POKEMONTCG_API_KEY } = process.env

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
    }))

    const { error } = await supabase.from('sets').upsert(sets)
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

async function populateCards(startPage = 1) {
  let page = startPage

  while (true) {
    const data = await fetchPage(`${BASE_URL}/cards`, page)
    if (!data) break

    const cards = data.map((card) => ({
      id: card.id,
      name: card.name,
      rarity: card.rarity ?? null,
      value: card.cardmarket?.prices?.averageSellPrice ?? 0,
      image_url: card.images.large,
      image_small: card.images.small,
      artist: card.artist ?? null,
      national_pokedex_number: card.nationalPokedexNumbers?.[0] ?? null,
      supertype: card.supertype,
      subtypes: card.subtypes ?? null,
      hp: card.hp ?? null,
      types: card.types ?? null,
      set_id: card.set.id,
    }))

    const { error } = await supabase.from('cards').upsert(cards)
    if (error) {
      console.error('Error inserting cards:', error.message)
      return
    }

    console.log(`Cards page ${page} done (${cards.length} cards)`)

    if (data.length < PAGE_SIZE) break
    page++
    await sleep(300)
  }

  console.log('Cards populated.')
}

const target = process.argv[2]
const startPage = Number(process.argv[3]) || 1

if (target === 'sets') {
  await populateSets()
} else if (target === 'cards') {
  await populateCards(startPage)
} else {
  console.error('Usage: node scripts/populate.mjs <sets|cards> [startPage]')
  process.exit(1)
}
