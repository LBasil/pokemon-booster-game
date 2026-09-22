import { supabase } from '@/lib/supabaseClient'

export async function fetchCollection() {
  const { data, error } = await supabase
    .from('collections')
    .select('card_id, quantity, acquired_at, cards(*)')
    .order('acquired_at', { ascending: false })

  if (error) throw error
  return data
}

/**
 * Atomically increments quantity for each card id (inserting new rows at
 * quantity 1 when the card isn't owned yet). Implemented server-side as a
 * single upsert so concurrent booster openings can't race each other.
 */
export async function addCardsToCollection(cards) {
  const cardIds = cards.map((card) => card.id)
  if (cardIds.length === 0) return

  const { error } = await supabase.rpc('add_cards_to_collection', { card_ids: cardIds })
  if (error) throw error
}

export async function fetchCollectionStats() {
  const [{ count: uniqueOwned }, { count: totalCards }] = await Promise.all([
    supabase.from('collections').select('card_id', { count: 'exact', head: true }),
    supabase.from('cards').select('id', { count: 'exact', head: true }),
  ])

  return { uniqueOwned: uniqueOwned ?? 0, totalCards: totalCards ?? 0 }
}
