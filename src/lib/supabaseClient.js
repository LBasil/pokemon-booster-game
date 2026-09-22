import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  console.warn(
    '[supabase] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. ' +
      'Copy .env.example to .env and fill in your Supabase project credentials.',
  )
}

export const isSupabaseConfigured = Boolean(url && anonKey)

// Fall back to a syntactically valid placeholder so createClient() doesn't
// throw when env vars are missing (e.g. running tests or a build without a
// configured .env yet) — isSupabaseConfigured is what actually gates usage.
export const supabase = createClient(url || 'https://placeholder.supabase.co', anonKey || 'placeholder-anon-key')
