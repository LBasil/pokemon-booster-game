import { defineStore } from 'pinia'
import { USERNAME_TAKEN, fetchMyProfile, updateMyProfile } from '@/api/profiles'
import { useAuthStore } from '@/stores/auth'

// The signed-in player's public profile row (username, visibility, showcase)
export const useProfileStore = defineStore('profile', {
  state: () => ({
    profile: null,
    loading: false,
    loaded: false,
    error: null,
  }),
  getters: {
    displayName: (state) => state.profile?.username || useAuthStore().displayName,
  },
  actions: {
    async load({ force = false } = {}) {
      const auth = useAuthStore()
      if (!auth.user || (this.loaded && !force) || this.loading) return
      this.loading = true
      this.error = null
      try {
        this.profile = await fetchMyProfile(auth.user.id)
        this.loaded = true
      } catch (err) {
        this.error = err
      } finally {
        this.loading = false
      }
    },

    /**
     * @param {{ username?: string, is_public?: boolean, showcase_card_id?: string|null }} fields
     * @throws {Error} with `code === 'taken'` when the username is already used
     */
    async update(fields) {
      const auth = useAuthStore()
      try {
        this.profile = await updateMyProfile(auth.user.id, fields)
      } catch (err) {
        if (err.code === USERNAME_TAKEN) throw Object.assign(new Error('username taken'), { code: 'taken' })
        throw err
      }
    },
  },
})
