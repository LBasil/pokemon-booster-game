<script setup>
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'

defineProps({
  // Pinned to the top-right corner; pass false to place it inline (e.g. in a header)
  floating: { type: Boolean, default: true },
})

const { t } = useI18n()
const theme = useThemeStore()
</script>

<template>
  <button
    type="button"
    class="theme-toggle"
    :class="{ 'theme-toggle-floating': floating }"
    :aria-label="theme.isLight ? t('common.switchToDark') : t('common.switchToLight')"
    :title="theme.isLight ? t('common.switchToDark') : t('common.switchToLight')"
    @click="theme.toggle()"
  >
    <!-- Moon: shown in light mode (click to go dark) -->
    <svg v-if="theme.isLight" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
    <!-- Sun: shown in dark mode (click to go light) -->
    <svg v-else viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4.5" />
      <path
        d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
      />
    </svg>
  </button>
</template>

<style scoped>
.theme-toggle {
  display: inline-grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  border: 1px solid var(--pb-border-strong);
  background: var(--pb-surface);
  color: var(--pb-text);
  backdrop-filter: blur(12px);
  transition:
    transform 0.3s var(--pb-ease-out),
    background-color 0.2s;
}

.theme-toggle:hover {
  background: var(--pb-surface-hover);
  transform: rotate(-15deg);
}

.theme-toggle svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.theme-toggle-floating {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 10;
}
</style>
