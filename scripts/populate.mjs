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

async function populateSets() {
  let page = 1

  while (true) {
    const response = await fetch(`${BASE_URL}/sets?page=${page}`, { headers })
    const { data } = await response.json()

    if (!data || data.length === 0) break

    const sets = data.map((set) => ({
      id: set.id,
      name: set.name,
      release_date: set.releaseDate,
      printed_total: set.printedTotal,
      total: set.total,
    }))

    const { error } = await supabase.from('sets').upsert(sets)
    if (error) {
      console.error('Error inserting sets:', error.message)
      return
    }

    console.log(`Sets page ${page} done (${sets.length} sets)`)
    page++
  }

  console.log('Sets populated.')
}

async function populateCards() {
  let page = 1

  while (true) {
    const response = await fetch(`${BASE_URL}/cards?page=${page}&pageSize=250`, { headers })
    const { data } = await response.json()

    if (!data || data.length === 0) break

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

    if (data.length < 250) break
    page++
  }

  console.log('Cards populated.')
}

const target = process.argv[2]

if (target === 'sets') {
  await populateSets()
} else if (target === 'cards') {
  await populateCards()
} else {
  console.error('Usage: node scripts/populate.mjs <sets|cards>')
  process.exit(1)
}
