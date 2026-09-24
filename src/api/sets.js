import { supabase } from '@/lib/supabaseClient'

export async function fetchSets() {
  const { data, error } = await supabase
    .from('sets')
    .select('id, name, release_date, printed_total, total')
    .order('release_date', { ascending: false })

  if (error) throw error
  return data
}

/** Size of the shared card pool (publicly readable, so this works signed out). */
export async function fetchPoolStats() {
  const [sets, cards] = await Promise.all([
    supabase.from('sets').select('id', { count: 'exact', head: true }),
    supabase.from('cards').select('id', { count: 'exact', head: true }),
  ])

  if (sets.error) throw sets.error
  if (cards.error) throw cards.error
  return { sets: sets.count ?? 0, cards: cards.count ?? 0 }
}

/**
 * The set's chase card (most valuable Pokémon), used as booster pack artwork.
 * Returns null if the set has no priced Pokémon card.
 */
export async function fetchSetCover(setId) {
  const { data, error } = await supabase
    .from('cards')
    .select('id, name, image_small, image_url')
    .eq('set_id', setId)
    .eq('supertype', 'Pokémon')
    .order('value', { ascending: false })
    .limit(1)

  if (error) throw error
  return data[0] ?? null
}
