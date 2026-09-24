<script setup>
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <span class="brand">
    <svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="pb-logo-holo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#6ee7f9" />
          <stop offset="0.35" stop-color="#a78bfa" />
          <stop offset="0.65" stop-color="#f472b6" />
          <stop offset="1" stop-color="#fcd34d" />
        </linearGradient>
      </defs>
      <!-- Back card -->
      <rect x="9" y="3" width="17" height="24" rx="3" transform="rotate(12 17.5 15)" class="brand-back" />
      <!-- Front holo card with a spark -->
      <rect x="5" y="5" width="17" height="24" rx="3" transform="rotate(-8 13.5 17)" fill="url(#pb-logo-holo)" />
      <path d="M13.5 11.5l1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5z" class="brand-spark" />
    </svg>
    <span class="brand-name">{{ t('common.brand') }}</span>
  </span>
</template>

<style scoped>
.brand {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  color: var(--pb-text);
}

.brand-mark {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
}

.brand-back {
  fill: none;
  stroke: var(--pb-text);
  stroke-width: 1.6;
  opacity: 0.5;
}

.brand-spark {
  fill: #fff;
}

.brand-name {
  font-family: var(--pb-font-display);
  font-weight: 700;
  font-size: 1.1rem;
  letter-spacing: -0.02em;
}
</style>
