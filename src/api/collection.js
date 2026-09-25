import { supabase } from '@/lib/supabaseClient'

/** The player's collection for one game mode ('unlimited' | 'challenge'), newest first. */
export async function fetchCollection(mode = 'unlimited') {
  const { data, error } = await supabase
    .from('collections')
    .select('card_id, quantity, acquired_at, cards(*)')
    .eq('mode', mode)
    .order('acquired_at', { ascending: false })

  if (error) throw error
  return data
}

export async function fetchCollectionStats(mode = 'unlimited') {
  const [{ count: uniqueOwned }, { count: totalCards }] = await Promise.all([
    supabase.from('collections').select('card_id', { count: 'exact', head: true }).eq('mode', mode),
    supabase.from('cards').select('id', { count: 'exact', head: true }),
  ])

  return { uniqueOwned: uniqueOwned ?? 0, totalCards: totalCards ?? 0 }
}
