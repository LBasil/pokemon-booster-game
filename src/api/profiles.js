import { supabase } from '@/lib/supabaseClient'
import { fetchAll } from '@/utils/fetchAll'

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
export function fetchPublicCollection(username) {
  return fetchAll(() =>
    supabase.rpc('public_collection', { p_username: username }).order('acquired_at', { ascending: false }).order('card_id'),
  )
}

/**
 * Public trainers whose username starts with `prefix` (case-insensitive), for
 * the trade partner autocomplete: [{ username, accepts_trades }], `excludeId`
 * (me) left out. RLS only lets public profiles (and mine) through.
 */
export async function searchUsernames(prefix, { excludeId, limit = 8 } = {}) {
  const run = (columns) => {
    let query = supabase.from('profiles').select(columns).ilike('username', `${exactPattern(prefix)}%`).eq('is_public', true)
    if (excludeId) query = query.neq('id', excludeId)
    return query.order('username').limit(limit)
  }
  let { data, error } = await run('username, accepts_trades')
  if (error?.code === MISSING_COLUMN) ({ data, error } = await run('username'))
  if (error) throw error
  return data.map((row) => ({ accepts_trades: true, ...row }))
}
