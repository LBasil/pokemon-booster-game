import { supabase } from '@/lib/supabaseClient'

const PROFILE_COLUMNS = 'id, username, is_public, showcase_card_id, created_at, accepts_trades'
// Before migration 0012 (no accepts_trades): read as accepting trades
const LEGACY_COLUMNS = 'id, username, is_public, showcase_card_id, created_at'
const MISSING_COLUMN = '42703'

async function withColumns(run) {
  let { data, error } = await run(PROFILE_COLUMNS)
  if (error?.code === MISSING_COLUMN) ({ data, error } = await run(LEGACY_COLUMNS))
  if (error) throw error
  return data && { accepts_trades: true, ...data }
}

// Postgres unique_violation: the username is taken
export const USERNAME_TAKEN = '23505'

export function fetchMyProfile(userId) {
  return withColumns((columns) => supabase.from('profiles').select(columns).eq('id', userId).maybeSingle())
}

/** Updates username / is_public / showcase_card_id / accepts_trades (the only client-editable columns). */
export function updateMyProfile(userId, fields) {
  return withColumns((columns) => supabase.from('profiles').update(fields).eq('id', userId).select(columns).single())
}

// LIKE treats _ and % as wildcards; escape them for an exact, case-insensitive match
const exactPattern = (text) => text.replace(/[\\%_]/g, (char) => `\\${char}`)

/** A public profile by username (case-insensitive), or null if private/unknown. */
export function fetchPublicProfile(username) {
  return withColumns((columns) => supabase.from('profiles').select(columns).ilike('username', exactPattern(username)).maybeSingle())
}

/** That profile's collection, same shape as fetchCollection() rows. */
export async function fetchPublicCollection(username) {
  const { data, error } = await supabase.rpc('public_collection', { p_username: username })
  if (error) throw error
  return data
}
