import { defineStore } from 'pinia'
import { supabase } from '@/lib/supabaseClient'
import { useChallengeStore } from '@/stores/challenge'
import { useChallengeCollectionStore, useCollectionStore } from '@/stores/collection'
import { useProfileStore } from '@/stores/profile'
import { useTradesStore } from '@/stores/trades'
import { useWishlistStore } from '@/stores/wishlist'

// Per-player caches must not survive a sign-out or an account switch
function resetPlayerStores() {
  useCollectionStore().$reset()
  useChallengeCollectionStore().$reset()
  useChallengeStore().$reset()
  useTradesStore().$reset()
  useProfileStore().$reset()
  useWishlistStore().$reset()
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    session: null,
    ready: false,
  }),
  getters: {
    isLoggedIn: (state) => Boolean(state.session),
    user: (state) => state.session?.user ?? null,
    // Fallback name until the profile (with the real username) is loaded
    displayName: (state) =>
      state.session?.user?.user_metadata?.username || state.session?.user?.email?.split('@')[0] || '',
  },
  actions: {
    async init() {
      const { data } = await supabase.auth.getSession()
      this.session = data.session
      this.ready = true

      supabase.auth.onAuthStateChange((_event, session) => {
        if (session?.user?.id !== this.session?.user?.id) resetPlayerStores()
        this.session = session
      })
    },

    async signUp({ email, password, username }) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        // The confirmation email brings the player straight back to the hub
        options: { data: { username }, emailRedirectTo: `${window.location.origin}/game` },
      })
      if (error) throw error
      this.session = data.session
      return data
    },

    async signIn({ email, password }) {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      this.session = data.session
      return data
    },

    // "Forgot password": Supabase emails a link back to /reset-password, which
    // signs the player in with a recovery session so they can pick a new one.
    // The URL must be listed in Supabase > Authentication > URL Configuration.
    async requestPasswordReset(email) {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      if (error) throw error
    },

    async updatePassword(password) {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
    },

    async signOut() {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      this.session = null
      resetPlayerStores()
    },
  },
})
