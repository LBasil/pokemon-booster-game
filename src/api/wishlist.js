import { supabase } from '@/lib/supabaseClient'
import { fetchAll } from '@/utils/fetchAll'

/** The player's wishlist with card details, newest first. */
export function fetchWishlist() {
  return fetchAll(() =>
    supabase.from('wishlist').select('card_id, created_at, cards(*)').order('created_at', { ascending: false }).order('card_id'),
  )
}

// user_id defaults to auth.uid() in the database
export async function addToWishlist(cardId) {
  const { error } = await supabase.from('wishlist').insert({ card_id: cardId })
  if (error && error.code !== '23505') throw error // already wished: fine
}

export async function removeFromWishlist(cardId) {
  const { error } = await supabase.from('wishlist').delete().eq('card_id', cardId)
  if (error) throw error
}
