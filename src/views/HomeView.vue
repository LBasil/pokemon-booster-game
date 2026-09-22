<script setup>
import { useI18n } from 'vue-i18n'
import ThemeToggle from '@/components/ThemeToggle.vue'
import LanguageSwitcher from '@/components/LanguageSwitcher.vue'
import AuthPanel from '@/components/AuthPanel.vue'

const { t } = useI18n()
</script>

<template>
  <div
    class="container text-center d-flex flex-column align-items-center justify-content-center min-vh-100 py-5"
  >
    <h1 class="display-5 text-shadow mb-2">{{ t('home.welcome') }}</h1>
    <p class="lead mb-4">{{ t('home.tagline') }}</p>

    <LanguageSwitcher class="mb-4" />

    <AuthPanel />

    <ThemeToggle />
  </div>
</template>
