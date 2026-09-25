<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useChallengeStore } from '@/stores/challenge'
import { useChallengeCollectionStore } from '@/stores/collection'
import { recyclePreview } from '@/utils/challenge'
import CoinAmount from '@/components/CoinAmount.vue'

// Challenge mode: "N duplicates → +X coins" with a two-step button that
// recycles every copy beyond the first (recycle_duplicates, migration 0005).
const emit = defineEmits(['recycled', 'error'])

const { t, locale } = useI18n()
const challenge = useChallengeStore()
const collection = useChallengeCollectionStore()

const preview = computed(() => recyclePreview(collection.entries))
const confirming = ref(false)
const busy = ref(false)

async function recycle() {
  busy.value = true
  try {
    const result = await challenge.recycle()
    confirming.value = false
    emit('recycled', result)
  } catch (err) {
    emit('error', err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="recycle">
    <p class="recycle-text">
      <template v-if="preview.cards">
        {{ t('challenge.recycleable', { count: preview.cards.toLocaleString(locale) }, preview.cards) }}
        <CoinAmount class="recycle-coins" :amount="preview.coins" signed />
      </template>
      <template v-else>{{ t('challenge.noDuplicates') }}</template>
    </p>
    <template v-if="preview.cards">
      <div v-if="confirming" class="recycle-actions">
        <button type="button" class="btn btn-primary btn-sm" :disabled="busy" @click="recycle">
          <span v-if="busy" class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>
          {{ t('challenge.recycleConfirm') }}
        </button>
        <button type="button" class="btn btn-outline-secondary btn-sm" :disabled="busy" @click="confirming = false">
          {{ t('common.cancel') }}
        </button>
      </div>
      <button v-else type="button" class="btn btn-outline-secondary btn-sm" @click="confirming = true">
        {{ t('challenge.recycleAll') }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.recycle {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.recycle-text {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  font-weight: 600;
  font-size: 0.92rem;
}

.recycle-coins {
  color: var(--pb-coin);
  font-weight: 800;
}

.recycle-actions {
  display: flex;
  gap: 0.5rem;
}
</style>
