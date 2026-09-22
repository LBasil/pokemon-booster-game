<script setup>
import { useThemeStore } from '@/stores/theme'

const theme = useThemeStore()
</script>

<template>
  <div class="theme-toggle">
    <span>🌙</span>
    <label class="switch">
      <input
        type="checkbox"
        :checked="theme.isLight"
        @change="theme.setLight($event.target.checked)"
      />
      <span class="slider round"></span>
    </label>
    <span>☀️</span>
  </div>
</template>
