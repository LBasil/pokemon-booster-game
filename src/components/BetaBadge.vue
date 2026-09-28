<script setup>
import { useI18n } from 'vue-i18n'

// "Beta tester" pill: a foil border with a light sweeping across it now and
// then. Shown next to the player's name when isBetaTester() (utils/beta).
defineProps({
  // Just "β" (tight spots like the hub tile)
  compact: { type: Boolean, default: false },
})

const { t } = useI18n()
</script>

<template>
  <span class="beta-badge" :class="{ compact }" :title="t('beta.why')">
    <span class="beta-mark" aria-hidden="true">β</span>
    <span v-if="!compact" class="beta-label">{{ t('beta.badge') }}</span>
    <span class="visually-hidden">{{ compact ? t('beta.badge') : '' }} {{ t('beta.why') }}</span>
  </span>
</template>

<style scoped>
.beta-badge {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.35em;
  padding: 0.18rem 0.65rem 0.18rem 0.3rem;
  border: 1.5px solid transparent;
  border-radius: 999px;
  background:
    linear-gradient(var(--pb-bg-elevated), var(--pb-bg-elevated)) padding-box,
    var(--pb-holo) border-box;
  font-size: 0.72rem;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  white-space: nowrap;
  overflow: hidden;
  vertical-align: middle;
}

.beta-badge.compact {
  padding: 0.18rem;
}

.beta-mark {
  display: grid;
  place-items: center;
  width: 1.45em;
  height: 1.45em;
  border-radius: 50%;
  background: var(--pb-holo);
  color: #0a0d1a;
  font-family: var(--pb-font-display);
  font-size: 0.95em;
  line-height: 1;
  text-transform: none;
}

.beta-label {
  background: var(--pb-holo-text);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

/* A glint crossing the badge every few seconds */
.beta-badge::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(105deg, transparent 35%, rgb(255 255 255 / 0.45) 50%, transparent 65%);
  transform: translateX(-120%);
  animation: beta-glint 4.5s ease-in-out 1s infinite;
  pointer-events: none;
}

@keyframes beta-glint {
  0%,
  70% {
    transform: translateX(-120%);
  }
  100% {
    transform: translateX(120%);
  }
}

:global(.pb-fx-off) .beta-badge::after {
  display: none;
}

@media (prefers-reduced-motion: reduce) {
  .beta-badge::after {
    display: none;
  }
}
</style>
