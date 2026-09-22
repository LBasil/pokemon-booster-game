<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { fetchSets } from '@/api/sets'
import { drawBooster } from '@/api/boosters'
import { addCardsToCollection } from '@/api/collection'
import { useCollectionStore } from '@/stores/collection'
import { groupCardsByQuantity } from '@/utils/cards'
import ThemeToggle from '@/components/ThemeToggle.vue'
import BoosterPack from '@/components/BoosterPack.vue'
import CardStack from '@/components/CardStack.vue'
import CardTile from '@/components/CardTile.vue'

const { t } = useI18n()
const collectionStore = useCollectionStore()

const COUNT_OPTIONS = [1, 3, 5, 10]

const sets = ref([])
const selectedSetId = ref('')
const count = ref(1)
const setsLoading = ref(true)
const loadError = ref('')

const phase = ref('select') // select | opening | revealing | done
const boosterIndex = ref(0)
const totalToOpen = ref(0)
const currentCards = ref([])
const revealedCount = ref(0)
const collectedCards = ref([])
const openError = ref('')

onMounted(async () => {
  try {
    sets.value = await fetchSets()
  } catch {
    loadError.value = t('boosters.loadError')
  } finally {
    setsLoading.value = false
  }
})

async function startOpening() {
  totalToOpen.value = count.value
  boosterIndex.value = 0
  collectedCards.value = []
  openError.value = ''
  await openNextBooster()
}

async function openNextBooster() {
  phase.value = 'opening'
  try {
    currentCards.value = await drawBooster(selectedSetId.value || null)
    revealedCount.value = 0
    setTimeout(() => {
      phase.value = 'revealing'
    }, 2500)
  } catch {
    openError.value = t('boosters.openError')
    phase.value = 'select'
  }
}

async function onStackTap() {
  if (revealedCount.value < currentCards.value.length) {
    revealedCount.value++
    return
  }
  await finishCurrentBooster()
}

async function finishCurrentBooster() {
  collectedCards.value.push(...currentCards.value)
  try {
    await addCardsToCollection(currentCards.value)
    collectionStore.invalidate()
  } catch {
    openError.value = t('boosters.openError')
  }

  boosterIndex.value++
  if (boosterIndex.value < totalToOpen.value) {
    await openNextBooster()
  } else {
    phase.value = 'done'
  }
}

function reset() {
  phase.value = 'select'
  collectedCards.value = []
}

const groupedCollectedCards = computed(() => groupCardsByQuantity(collectedCards.value))
</script>

<template>
  <div class="container text-center py-5">
    <ThemeToggle />
    <h1 class="mb-4">{{ t('boosters.title') }}</h1>

    <div v-if="phase === 'select'" class="mx-auto" style="max-width: 420px">
      <div v-if="loadError" class="alert alert-danger">{{ loadError }}</div>
      <div v-if="openError" class="alert alert-danger">{{ openError }}</div>

      <div class="mb-3 text-start">
        <label class="form-label" for="set-select">{{ t('boosters.setLabel') }}</label>
        <select id="set-select" v-model="selectedSetId" class="form-select" :disabled="setsLoading">
          <option value="">{{ t('boosters.anySet') }}</option>
          <option v-for="set in sets" :key="set.id" :value="set.id">{{ set.name }}</option>
        </select>
      </div>

      <div class="mb-4 text-start">
        <label class="form-label" for="count-select">{{ t('boosters.countLabel') }}</label>
        <select id="count-select" v-model.number="count" class="form-select">
          <option v-for="n in COUNT_OPTIONS" :key="n" :value="n">{{ n }}</option>
        </select>
      </div>

      <button type="button" class="btn btn-primary btn-lg glow-button" @click="startOpening">
        {{ t('boosters.openButton', { count }, count) }}
      </button>
    </div>

    <div v-else-if="phase === 'opening' || phase === 'revealing'">
      <p v-if="totalToOpen > 1" class="mb-3">
        {{ t('boosters.boosterProgress', { current: boosterIndex + 1, total: totalToOpen }) }}
      </p>

      <BoosterPack :opening="phase === 'opening'" />

      <template v-if="phase === 'revealing'">
        <CardStack :cards="currentCards" :revealed-count="revealedCount" @tap="onStackTap" />
        <p class="mt-3 text-body-secondary">{{ t('boosters.tapToReveal') }}</p>
      </template>
    </div>

    <div v-else-if="phase === 'done'">
      <h2 class="mb-4">{{ collectedCards.length }} 🎉</h2>
      <div class="d-flex flex-wrap justify-content-center gap-3 mb-4">
        <CardTile
          v-for="entry in groupedCollectedCards"
          :key="entry.card.id"
          :card="entry.card"
          :quantity="entry.quantity > 1 ? entry.quantity : null"
        />
      </div>
      <div class="d-flex justify-content-center gap-3">
        <button type="button" class="btn btn-primary glow-button" @click="reset">
          {{ t('boosters.openAnother') }}
        </button>
        <RouterLink :to="{ name: 'collection' }" class="btn btn-outline-secondary">
          {{ t('game.viewCollection') }}
        </RouterLink>
      </div>
    </div>
  </div>
</template>
