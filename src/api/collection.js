import { supabase } from '@/lib/supabaseClient'

export async function fetchCollection() {
  const { data, error } = await supabase
    .from('collections')
    .select('card_id, quantity, acquired_at, cards(*)')
    .eq('mode', 'unlimited')
    .order('acquired_at', { ascending: false })

  if (error) throw error
  return data
}

export async function fetchCollectionStats() {
  const [{ count: uniqueOwned }, { count: totalCards }] = await Promise.all([
    supabase.from('collections').select('card_id', { count: 'exact', head: true }).eq('mode', 'unlimited'),
    supabase.from('cards').select('id', { count: 'exact', head: true }),
  ])

  return { uniqueOwned: uniqueOwned ?? 0, totalCards: totalCards ?? 0 }
}
