import { computed, ref, toValue, watch } from 'vue'
import { fetchPlayerAchievements } from '@/api/achievements'
import { fetchChallengeCollectionOf } from '@/api/challenge'
import { fetchPublicCollection, fetchPublicProfile } from '@/api/profiles'
import { useAchievementsStore } from '@/stores/achievements'
import { useModeCollectionStore } from '@/stores/collection'
import { useSetsStore } from '@/stores/sets'
import { achievementProgress, achievements, rateOf } from '@/utils/achievements'

/**
 * A player's achievements in one game mode: their own (stores; also toasts
 * anything unlocked since the last check) or a public profile's (fetched).
 * @param {import('vue').MaybeRefOrGetter<string>} mode - 'unlimited' | 'challenge'
 * @param {import('vue').MaybeRefOrGetter<string>} [username] - empty = own
 */
export function useModeAchievements(mode, username = '') {
  const store = useAchievementsStore()
  const setsStore = useSetsStore()
  const isOwn = computed(() => !toValue(username))

  // ---------- Public profile ----------
  const publicName = ref('')
  const publicEntries = ref([])
  const publicServer = ref(null)
  const publicState = ref('idle') // loading | ready | missing | error

  async function loadPublic(name, currentMode) {
    publicState.value = 'loading'
    try {
      const profile = await fetchPublicProfile(name)
      if (!profile) {
        publicState.value = 'missing'
        return
      }
      publicName.value = profile.username
      const [entries, server] = await Promise.all([
        currentMode === 'challenge' ? fetchChallengeCollectionOf(profile.username) : fetchPublicCollection(profile.username),
        fetchPlayerAchievements(currentMode, profile.username).catch(() => null),
      ])
      // The mode may have changed meanwhile
      if (currentMode !== toValue(mode)) return
      publicEntries.value = entries
      publicServer.value = server
      publicState.value = 'ready'
    } catch {
      publicState.value = 'error'
    }
  }

  watch(
    () => [toValue(mode), toValue(username)],
    ([currentMode, name]) => {
      setsStore.load()
      store.loadRates(currentMode)
      if (name) loadPublic(name, currentMode)
      else store.check(currentMode)
    },
    { immediate: true },
  )

  // ---------- Own ----------
  const collection = computed(() => useModeCollectionStore(toValue(mode)))

  const list = computed(() => {
    const currentMode = toValue(mode)
    const entries = isOwn.value ? collection.value.entries : publicEntries.value
    const server = isOwn.value ? store.server[currentMode] : publicServer.value
    return achievements(entries, setsStore.sets, { mode: currentMode, ...server })
  })

  return {
    list,
    progress: computed(() => achievementProgress(list.value)),
    rate: (item) => rateOf(item, store.rates[toValue(mode)], isOwn.value),
    hasRates: computed(() => Boolean(store.rates[toValue(mode)]?.players)),
    firstLoad: computed(() => (isOwn.value ? !collection.value.loaded && !collection.value.error : ['idle', 'loading'].includes(publicState.value))),
    failed: computed(() => (isOwn.value ? Boolean(collection.value.error) && !collection.value.loaded : publicState.value === 'error')),
    missing: computed(() => publicState.value === 'missing'),
    publicName,
  }
}
