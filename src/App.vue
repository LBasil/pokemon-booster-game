<script setup>
import { onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
onMounted(() => {
  if (!auth.ready) auth.init()
})
</script>

<template>
  <!-- Keyed by route name: /boosters and /challenge/boosters share a component
       but must not share an instance (state, mode-specific stores) -->
  <RouterView v-slot="{ Component, route }">
    <component :is="Component" :key="route.name" />
  </RouterView>
</template>
