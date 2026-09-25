<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { useChallengeStore } from '@/stores/challenge'

// "Unlimited | Challenge" segmented switch at the top of both hubs: shows
// which mode you're in and moves to the other one in one tap.
const { t } = useI18n()
const route = useRoute()
const challenge = useChallengeStore()

const current = computed(() => (route.meta.mode === 'challenge' ? 'challenge' : 'unlimited'))
const MODES = [
  { mode: 'unlimited', to: 'game', label: 'nav.modeUnlimited' },
  { mode: 'challenge', to: 'challenge', label: 'nav.modeChallenge' },
]
const waiting = computed(() => challenge.badge.rewards + challenge.badge.trades)
</script>

<template>
  <nav class="mode-switch" :aria-label="t('nav.modeSwitch')">
    <RouterLink
      v-for="item in MODES"
      :key="item.mode"
      :to="{ name: item.to }"
      :class="{ active: current === item.mode }"
      :aria-current="current === item.mode ? 'page' : undefined"
    >
      {{ t(item.label) }}
      <span v-if="item.mode === 'challenge' && current !== 'challenge' && waiting" class="mode-switch-badge">
        {{ waiting }}<span class="visually-hidden"> {{ t('nav.pending', waiting) }}</span>
      </span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.mode-switch {
  display: flex;
  width: fit-content;
  gap: 4px;
  padding: 4px;
  border-radius: 999px;
  border: 1px solid var(--pb-border-strong);
  background: var(--pb-surface);
  backdrop-filter: blur(12px);
}

.mode-switch a {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 1.1rem;
  border-radius: 999px;
  color: var(--pb-text-muted);
  font-weight: 700;
  font-size: 0.9rem;
  white-space: nowrap;
  transition:
    color 0.2s,
    background-color 0.2s;
}

.mode-switch a:hover {
  color: var(--pb-text);
}

.mode-switch a.active {
  background: var(--pb-text);
  color: var(--pb-bg);
}

.mode-switch-badge {
  display: inline-grid;
  place-items: center;
  min-width: 1.15rem;
  height: 1.15rem;
  padding: 0 0.3rem;
  border-radius: 999px;
  background: var(--pb-accent);
  color: var(--pb-accent-ink);
  font-size: 0.68rem;
  font-weight: 800;
}
</style>
