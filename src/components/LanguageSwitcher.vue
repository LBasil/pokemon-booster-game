<script setup>
import { useI18n } from 'vue-i18n'
import { setLocale } from '@/i18n'

const { t, locale } = useI18n()

const LOCALES = [
  { code: 'en', label: 'EN', name: 'English' },
  { code: 'fr', label: 'FR', name: 'Français' },
]
</script>

<template>
  <div class="language-switcher" role="group" :aria-label="t('common.language')">
    <button
      v-for="option in LOCALES"
      :key="option.code"
      type="button"
      :lang="option.code"
      :title="option.name"
      :aria-pressed="locale === option.code"
      :class="{ active: locale === option.code }"
      @click="setLocale(option.code)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<style scoped>
.language-switcher {
  display: inline-flex;
  padding: 4px;
  gap: 2px;
  border-radius: 999px;
  border: 1px solid var(--pb-border-strong);
  background: var(--pb-surface);
  backdrop-filter: blur(12px);
}

.language-switcher button {
  min-width: 40px;
  height: 32px;
  padding: 0 0.6rem;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--pb-text-muted);
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  transition:
    background-color 0.2s,
    color 0.2s;
}

.language-switcher button:hover {
  color: var(--pb-text);
}

.language-switcher button.active {
  background: var(--pb-text);
  color: var(--pb-bg);
}
</style>
