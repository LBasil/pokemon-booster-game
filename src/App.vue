<script setup>
import { onMounted, ref, watch, watchEffect } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useSettingsStore } from '@/stores/settings'
import AchievementToasts from '@/components/AchievementToasts.vue'
import PointerFx from '@/components/PointerFx.vue'

const auth = useAuthStore()
onMounted(() => {
  if (!auth.ready) auth.init()
})

// Visual effects off (Profile > Settings): one class on <html> turns off the
// page transitions in global.css; PointerFx reads the setting itself
const settings = useSettingsStore()
watchEffect(() => document.documentElement.classList.toggle('pb-fx-off', !settings.effects))

// A foil line sweeps across the top on every page change
const route = useRoute()
const sweep = ref(0)
watch(
  () => route.name,
  (name, previous) => {
    if (previous) sweep.value++
  },
)
</script>

<template>
  <!-- Keyed by route name: /boosters and /challenge/boosters share a component
       but must not share an instance (state, mode-specific stores) -->
  <RouterView v-slot="{ Component, route: current }">
    <component :is="Component" :key="current.name" />
  </RouterView>
  <div v-if="sweep" :key="sweep" class="route-sweep" aria-hidden="true" />
  <AchievementToasts />
  <PointerFx />
</template>
