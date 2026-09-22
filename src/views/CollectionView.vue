<script setup>
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCollectionStore } from '@/stores/collection'
import ThemeToggle from '@/components/ThemeToggle.vue'
import CardTile from '@/components/CardTile.vue'

const { t } = useI18n()
const collectionStore = useCollectionStore()

onMounted(() => {
  collectionStore.load()
})
</script>

<template>
  <div class="container text-center py-5">
    <ThemeToggle />
    <h1 class="mb-2">{{ t('collection.title') }}</h1>
    <p class="mb-4 text-body-secondary">
      {{ t('collection.owned', { owned: collectionStore.stats.uniqueOwned, total: collectionStore.stats.totalCards }) }}
    </p>

    <div v-if="collectionStore.loading" class="py-5">{{ t('common.loading') }}</div>

    <div v-else-if="collectionStore.entries.length === 0" class="py-5">
      <p>{{ t('collection.empty') }}</p>
      <RouterLink :to="{ name: 'boosters' }" class="btn btn-primary glow-button">
        {{ t('collection.goOpen') }}
      </RouterLink>
    </div>

    <div v-else class="d-flex flex-wrap justify-content-center gap-3">
      <CardTile
        v-for="entry in collectionStore.entries"
        :key="entry.card_id"
        :card="entry.cards"
        :quantity="entry.quantity"
      />
    </div>
  </div>
</template>
