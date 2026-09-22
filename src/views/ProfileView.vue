<script setup>
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useCollectionStore } from '@/stores/collection'
import ThemeToggle from '@/components/ThemeToggle.vue'

const { t } = useI18n()
const router = useRouter()
const auth = useAuthStore()
const collectionStore = useCollectionStore()

onMounted(() => {
  collectionStore.load()
})

const username = computed(() => auth.user?.user_metadata?.username || null)
const memberSince = computed(() =>
  auth.user?.created_at ? new Date(auth.user.created_at).toLocaleDateString() : '',
)
const totalCardsDrawn = computed(() =>
  collectionStore.entries.reduce((sum, entry) => sum + entry.quantity, 0),
)

async function logout() {
  await auth.signOut()
  router.push({ name: 'home' })
}
</script>

<template>
  <div class="container text-center py-5">
    <ThemeToggle />
    <h1 class="mb-4">{{ t('profile.title') }}</h1>

    <div class="mx-auto text-start" style="max-width: 420px">
      <dl class="row">
        <dt class="col-6">{{ t('profile.email') }}</dt>
        <dd class="col-6">{{ auth.user?.email }}</dd>

        <dt class="col-6">{{ t('profile.username') }}</dt>
        <dd class="col-6">{{ username || t('profile.notSet') }}</dd>

        <dt class="col-6">{{ t('profile.memberSince') }}</dt>
        <dd class="col-6">{{ memberSince }}</dd>

        <dt class="col-6">{{ t('profile.cardsOwned') }}</dt>
        <dd class="col-6">{{ collectionStore.stats.uniqueOwned }}</dd>

        <dt class="col-6">{{ t('profile.totalCards') }}</dt>
        <dd class="col-6">{{ totalCardsDrawn }}</dd>
      </dl>

      <button type="button" class="btn btn-outline-secondary w-100" @click="logout">
        {{ t('common.logout') }}
      </button>
    </div>
  </div>
</template>
