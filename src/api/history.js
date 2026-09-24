import { supabase } from '@/lib/supabaseClient'

/**
 * The player's past boosters, newest first, page by page.
 * @param {{ before?: string, limit?: number }} [options] - `before` = opened_at of the last row already shown
 */
export async function fetchOpenings({ before, limit = 20 } = {}) {
  let query = supabase
    .from('booster_openings')
    .select('id, set_id, card_ids, best_card_id, hits, secrets, opened_at')
    .eq('mode', 'unlimited')
    .order('opened_at', { ascending: false })
    .limit(limit)
  if (before) query = query.lt('opened_at', before)
  const { data, error } = await query
  if (error) throw error
  return data
}
