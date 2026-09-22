import { supabase } from '@/lib/supabaseClient'

export async function fetchSets() {
  const { data, error } = await supabase
    .from('sets')
    .select('id, name, release_date, printed_total, total')
    .order('release_date', { ascending: false })

  if (error) throw error
  return data
}
