import { supabase } from '@/lib/supabaseClient'

/**
 * The player's past boosters for one game mode, newest first, page by page.
 * @param {{ mode?: string, before?: string, limit?: number, hitsOnly?: boolean }} [options] - `before` = opened_at of the last row already shown;
 *   `hitsOnly` = packs with an ultra rare or better
 */
export async function fetchOpenings({ mode = 'unlimited', before, limit = 20, hitsOnly = false } = {}) {
  let query = supabase
    .from('booster_openings')
    .select('id, set_id, card_ids, best_card_id, hits, secrets, god_pack, opened_at')
    .eq('mode', mode)
    .order('opened_at', { ascending: false })
    .limit(limit)
  if (before) query = query.lt('opened_at', before)
  if (hitsOnly) query = query.gt('hits', 0)
  const { data, error } = await query
  if (error) throw error
  return data
}
