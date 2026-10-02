<script setup>
import { onMounted, watch, watchEffect } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'
import { useTradesStore } from '@/stores/trades'
import AchievementToasts from '@/components/AchievementToasts.vue'
import PointerFx from '@/components/PointerFx.vue'

const auth = useAuthStore()
onMounted(() => {
  if (!auth.ready) auth.init()
})

// Incoming trade offers and answers arrive live while signed in
const trades = useTradesStore()
let stopTrades = null
watch(
  () => auth.user?.id,
  (userId) => {
    stopTrades?.()
    stopTrades = userId ? trades.live(userId) : null
  },
  { immediate: true },
)

// Visual effects off (Profile > Settings): one class on <html> turns off the
// page fade in global.css; PointerFx reads the setting itself
const settings = useSettingsStore()
watchEffect(() => document.documentElement.classList.toggle('pb-fx-off', !settings.effects))
// Larger text (same page): bigger rems + darker secondary text
watchEffect(() => document.documentElement.classList.toggle('pb-text-large', settings.largeText))
</script>

<template>
  <!-- Keyed by route name: /boosters and /challenge/boosters share a component
       but must not share an instance (state, mode-specific stores) -->
  <RouterView v-slot="{ Component, route: current }">
    <component :is="Component" :key="current.name" />
  </RouterView>
  <AchievementToasts />
  <PointerFx />
</template>
