import { supabase } from '@/lib/supabaseClient'

const PROFILE_COLUMNS = 'id, username, is_public, showcase_card_id, created_at'

// Postgres unique_violation: the username is taken
export const USERNAME_TAKEN = '23505'

export async function fetchMyProfile(userId) {
  const { data, error } = await supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).maybeSingle()
  if (error) throw error
  return data
}

/** Updates username / is_public / showcase_card_id (the only client-editable columns). */
export async function updateMyProfile(userId, fields) {
  const { data, error } = await supabase
    .from('profiles')
    .update(fields)
    .eq('id', userId)
    .select(PROFILE_COLUMNS)
    .single()
  if (error) throw error
  return data
}

// LIKE treats _ and % as wildcards; escape them for an exact, case-insensitive match
const exactPattern = (text) => text.replace(/[\\%_]/g, (char) => `\\${char}`)

/** A public profile by username (case-insensitive), or null if private/unknown. */
export async function fetchPublicProfile(username) {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .ilike('username', exactPattern(username))
    .maybeSingle()
  if (error) throw error
  return data
}

/** That profile's collection, same shape as fetchCollection() rows. */
export async function fetchPublicCollection(username) {
  const { data, error } = await supabase.rpc('public_collection', { p_username: username })
  if (error) throw error
  return data
}
