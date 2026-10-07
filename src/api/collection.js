import { supabase } from '@/lib/supabaseClient'
import { fetchAll } from '@/utils/fetchAll'

/** The player's collection for one game mode ('unlimited' | 'challenge'), newest first. */
export function fetchCollection(mode = 'unlimited') {
  // a pack's 10 cards share acquired_at: card_id keeps the pages stable
  return fetchAll(() =>
    supabase
      .from('collections')
      .select('card_id, quantity, acquired_at, cards(*)')
      .eq('mode', mode)
      .order('acquired_at', { ascending: false })
      .order('card_id'),
  )
}

export async function fetchCollectionStats(mode = 'unlimited') {
  const [{ count: uniqueOwned }, { count: totalCards }] = await Promise.all([
    supabase.from('collections').select('card_id', { count: 'exact', head: true }).eq('mode', mode),
    supabase.from('cards').select('id', { count: 'exact', head: true }),
  ])

  return { uniqueOwned: uniqueOwned ?? 0, totalCards: totalCards ?? 0 }
}
