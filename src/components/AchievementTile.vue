<script setup>
import { useI18n } from 'vue-i18n'
import { useAchievementText } from '@/composables/useAchievementText'

// One achievement: category icon, title, description, progress while locked.
// Unlocked ones get the foil border; secret ones stay "???" until unlocked.
// `rate`: share of players who have it (%), null when unknown.
defineProps({
  item: { type: Object, required: true },
  rate: { type: Number, default: null },
})

const { t } = useI18n()
const text = useAchievementText()

const ICONS = {
  packs: 'M7 3h10l1 3-1 15H7L6 6zM6 6h12',
  collection: 'M8 3h11v15H8zM5 6v15h11',
  pulls: 'M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2z',
  sets: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  pokedex: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h6M15 12h6M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  teams: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M18 14a6 6 0 0 1 4 7',
  types: 'M12 3c3 4 6 6.5 6 10a6 6 0 0 1-12 0c0-3.5 3-6 6-10z',
  trainers: 'M4 8h16v11H4zM9 8V5h6v3M4 13h16',
  mechanics: 'M13 2L4 14h7l-1 8 9-12h-7z',
  treasure: 'M6 3h12l3 6-9 12L3 9zM3 9h18M9 3l3 18 3-18',
  history: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  artists: 'M12 3a9 9 0 0 0 0 18c1.5 0 2-1 2-2s-1-1.5-1-2.5 1-1.5 2-1.5h2a4 4 0 0 0 4-4c0-4.4-4-8-9-8zM7.5 11.5h.01M10 7.5h.01M15 7.5h.01',
  fun: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01',
  dedication: 'M4 5h16v15H4zM4 10h16M9 3v4M15 3v4',
  secret: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
}
</script>

<template>
  <li class="achv" :class="{ unlocked: item.unlocked, secret: text.secret(item) }">
    <span class="achv-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path :d="ICONS[text.secret(item) ? 'secret' : item.category]" /></svg>
    </span>
    <span class="achv-body">
      <span class="achv-title">{{ text.title(item) }}</span>
      <span class="achv-desc">{{ text.desc(item) }}</span>
      <span v-if="!item.unlocked && item.target > 1 && !text.secret(item)" class="achv-progress">
        <span class="achv-bar" aria-hidden="true"><span :style="{ width: `${item.ratio * 100}%` }"></span></span>
        <span class="achv-progress-text">{{ text.progress(item) }}</span>
      </span>
      <span v-if="rate !== null" class="achv-rate" :class="{ 'is-rare': rate < 5 }">{{ text.rate(rate) }}</span>
    </span>
    <span class="visually-hidden">{{ item.unlocked ? t('profile.unlocked') : t('profile.locked') }}</span>
  </li>
</template>

<style scoped>
/* Not .badge: Bootstrap already styles that class (centered, nowrap) */
.achv {
  display: flex;
  gap: 0.8rem;
  align-items: flex-start;
  padding: 0.85rem;
  border-radius: var(--pb-radius-md);
  border: 1px solid var(--pb-border);
  background: var(--pb-input-bg);
}

.achv-icon {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: var(--pb-selected);
  color: var(--pb-text-muted);
}

.achv-icon svg {
  width: 22px;
  height: 22px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.achv.unlocked {
  background:
    linear-gradient(var(--pb-bg-elevated), var(--pb-bg-elevated)) padding-box,
    var(--pb-holo) border-box;
  border: 1px solid transparent;
}

.achv.unlocked .achv-icon {
  background: var(--pb-holo);
  color: var(--pb-accent-ink);
}

.achv.secret {
  border-style: dashed;
}

.achv-body {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
  flex: 1;
}

.achv-title {
  font-weight: 800;
}

.achv:not(.unlocked) .achv-title {
  color: var(--pb-text-muted);
}

.achv-desc {
  font-size: 0.8rem;
  color: var(--pb-text-muted);
}

.achv-progress {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.35rem;
}

.achv-bar {
  flex: 1;
  display: block;
  height: 6px;
  border-radius: 999px;
  background: var(--pb-input-bg);
  border: 1px solid var(--pb-border);
  overflow: hidden;
}

.achv-bar > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--pb-holo);
}

.achv-rate {
  margin-top: 0.2rem;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--pb-text-muted);
}

/* Held by fewer than 5% of players */
.achv.unlocked .achv-rate.is-rare {
  width: fit-content;
  background: var(--pb-holo-text);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.achv-progress-text {
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--pb-text-muted);
  white-space: nowrap;
}
</style>
