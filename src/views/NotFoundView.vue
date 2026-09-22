<script setup>
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <div class="container text-center py-5">
    <h1>{{ t('notFound.title') }}</h1>
    <RouterLink :to="{ name: 'home' }" class="btn btn-primary mt-3">
      {{ t('notFound.backHome') }}
    </RouterLink>
  </div>
</template>
