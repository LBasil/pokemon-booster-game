<script setup>
import { useI18n } from 'vue-i18n'
import { setLocale } from '@/i18n'

const { t, locale } = useI18n()
</script>

<template>
  <div class="language-select">
    <label class="visually-hidden" for="language-select">{{ t('common.language') }}</label>
    <select
      id="language-select"
      class="form-select form-select-lg"
      :value="locale"
      @change="setLocale($event.target.value)"
    >
      <option value="en">English</option>
      <option value="fr">Français</option>
    </select>
  </div>
</template>
