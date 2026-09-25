import { supabase } from '@/lib/supabaseClient'

// Postgres "undefined column": migration 0003 isn't applied yet
const MISSING_COLUMN = '42703'

export async function fetchSets() {
  const query = (columns) => supabase.from('sets').select(columns).order('release_date', { ascending: false })

  // Each fallback drops what a missing migration (0010, then 0003) didn't add
  let { data, error } = await query('id, name, release_date, printed_total, total, logo_url, symbol_url, parent_set_id, subset_rate')
  if (error?.code === MISSING_COLUMN) ({ data, error } = await query('id, name, release_date, printed_total, total, logo_url, symbol_url'))
  if (error?.code === MISSING_COLUMN) ({ data, error } = await query('id, name, release_date, printed_total, total'))

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
 * The set's chase card, used as booster pack artwork: the most valuable
 * Pokémon among its hits (brand-new sets often have no prices yet, so the
 * rarity filter keeps it from landing on a random common). Returns null if
 * the set has no Pokémon card.
 */
export async function fetchSetCover(setId) {
  const query = () =>
    supabase
      .from('cards')
      .select('id, name, image_small, image_url')
      .eq('set_id', setId)
      .eq('supertype', 'Pokémon')
      .order('value', { ascending: false })
      .limit(1)

  const hits = await query().in('rarity_bucket', ['secret', 'ultra', 'holo'])
  if (!hits.error && hits.data.length) return hits.data[0]

  // No hits in the set, or migration 0003 not applied (no rarity_bucket column)
  const { data, error } = await query()
  if (error) throw error
  return data[0] ?? null
}
