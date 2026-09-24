import { supabase } from '@/lib/supabaseClient'

const CARD_COLUMNS =
  'id, name, rarity, rarity_bucket, value, image_small, image_url, set_id, national_pokedex_number, supertype, hp, types, artist'

/** Every card of a set (for the binder view). */
export async function fetchSetCards(setId) {
  const { data, error } = await supabase.from('cards').select(CARD_COLUMNS).eq('set_id', setId)
  if (error) throw error
  return data
}

/** Cards by id (for the opening history). */
export async function fetchCardsByIds(ids) {
  if (!ids.length) return []
  const { data, error } = await supabase.from('cards').select(CARD_COLUMNS).in('id', ids)
  if (error) throw error
  return data
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
