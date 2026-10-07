<script setup>
import { useI18n } from 'vue-i18n'

// "Alpha" pill for a feature open to all whose rules may still change (PvP,
// 0037). The reason is in the tooltip and for screen readers; pages that
// need it spelled out add `alpha.note` themselves.
const { t } = useI18n()
</script>

<template>
  <span class="alpha-tag" :title="t('alpha.why')">
    {{ t('alpha.tag') }}<span class="visually-hidden">: {{ t('alpha.why') }}</span>
  </span>
</template>

<style scoped>
.alpha-tag {
  display: inline-block;
  padding: 0.1rem 0.5rem;
  border: 1.5px solid var(--pb-accent);
  border-radius: 999px;
  color: var(--pb-accent);
  font-family: var(--pb-font-body);
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  line-height: 1.4;
  text-transform: uppercase;
  white-space: nowrap;
  vertical-align: middle;
}

[data-bs-theme='light'] .alpha-tag {
  color: var(--pb-accent-ink);
  background: var(--pb-accent);
}
</style>
