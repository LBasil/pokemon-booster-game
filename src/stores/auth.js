import { defineStore } from 'pinia'
import { supabase } from '@/lib/supabaseClient'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    session: null,
    ready: false,
  }),
  getters: {
    isLoggedIn: (state) => Boolean(state.session),
    user: (state) => state.session?.user ?? null,
    // Username if set, else the part of the email before the "@"
    displayName: (state) =>
      state.session?.user?.user_metadata?.username || state.session?.user?.email?.split('@')[0] || '',
  },
  actions: {
    async init() {
      const { data } = await supabase.auth.getSession()
      this.session = data.session
      this.ready = true

      supabase.auth.onAuthStateChange((_event, session) => {
        this.session = session
      })
    },

    async signUp({ email, password, username }) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { username } },
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

    // Profile fields live in Supabase Auth user metadata (only the owner can
    // read them): `username`, and `showcase_card_id` for the profile's
    // showcase card. Merged, so other metadata keys are kept.
    async updateProfile(fields) {
      const { data, error } = await supabase.auth.updateUser({ data: fields })
      if (error) throw error
      if (this.session) this.session = { ...this.session, user: data.user }
      return data.user
    },

    async signOut() {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      this.session = null
    },
  },
})
