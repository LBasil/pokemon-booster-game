import { supabase } from '@/lib/supabaseClient'

const CARD_COLUMNS =
  'id, name, rarity, rarity_bucket, value, image_small, image_url, set_id, national_pokedex_number, supertype, hp, types, artist'
// French name and image (migration 0029); without them before it's applied
const FR_COLUMNS = ', name_fr, image_fr'
const MISSING_COLUMN = '42703'

async function selectCards(filter) {
  let { data, error } = await filter(supabase.from('cards').select(CARD_COLUMNS + FR_COLUMNS))
  if (error?.code === MISSING_COLUMN) ({ data, error } = await filter(supabase.from('cards').select(CARD_COLUMNS)))
  if (error) throw error
  return data
}

/** Every card of a set (for the binder view). */
export function fetchSetCards(setId) {
  return selectCards((query) => query.eq('set_id', setId))
}

/** Cards by id (for the opening history). */
export async function fetchCardsByIds(ids) {
  if (!ids.length) return []
  return selectCards((query) => query.in('id', ids))
}

/** Highest national Pokédex number in the card pool. */
export async function fetchPokedexSize() {
  const { data, error } = await supabase
    .from('cards')
    .select('national_pokedex_number')
    .not('national_pokedex_number', 'is', null)
    .order('national_pokedex_number', { ascending: false })
    .limit(1)
  if (error) throw error
  return data[0]?.national_pokedex_number ?? 0
}

/** Weekly Cardmarket price snapshots for a card, oldest first. */
export async function fetchPriceHistory(cardId) {
  const { data, error } = await supabase
    .from('card_price_history')
    .select('recorded_on, value')
    .eq('card_id', cardId)
    .order('recorded_on', { ascending: true })
  if (error) throw error
  return data
}
