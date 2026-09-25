<script setup>
import { useI18n } from 'vue-i18n'
import { useAchievementText } from '@/composables/useAchievementText'
import { useAchievementsStore } from '@/stores/achievements'
import { rateOf } from '@/utils/achievements'

// "Achievement unlocked" pop-ups, Steam style: bottom right on desktop, at
// the top on phones (the tab bar owns the bottom). Mounted once in App.vue;
// the achievements store decides what to show.
const { t } = useI18n()
const store = useAchievementsStore()
const text = useAchievementText()
</script>

<template>
  <div class="ach-toasts" aria-live="polite">
    <TransitionGroup name="ach-toast">
      <div v-for="toast in store.toasts" :key="toast.key" class="ach-toast" role="status">
        <RouterLink
          :to="toast.item ? { name: 'achievements', query: { cat: toast.item.category } } : { name: 'achievements', query: { status: 'unlocked' } }"
          class="ach-toast-link"
          @click="store.dismiss(toast.key)"
        >
          <span class="ach-toast-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4" /></svg>
          </span>
          <span v-if="toast.item" class="ach-toast-body">
            <span class="ach-toast-eyebrow">{{ toast.item.hidden ? t('achievements.ui.secretUnlocked') : t('achievements.ui.unlockedToast') }}</span>
            <span class="ach-toast-title">{{ text.title(toast.item) }}</span>
            <span class="ach-toast-desc">{{ text.desc(toast.item) }}</span>
            <span v-if="rateOf(toast.item, store.rates, true) !== null" class="ach-toast-rate">
              {{ text.rate(rateOf(toast.item, store.rates, true)) }}
            </span>
          </span>
          <span v-else class="ach-toast-body">
            <span class="ach-toast-eyebrow">{{ t('achievements.ui.unlockedToast') }}</span>
            <span class="ach-toast-title">{{ t('achievements.ui.moreUnlocked', { count: toast.more }, toast.more) }}</span>
            <span class="ach-toast-desc">{{ t('achievements.ui.seeAll') }}</span>
          </span>
        </RouterLink>
        <button type="button" class="ach-toast-close" :aria-label="t('achievements.ui.dismiss')" @click="store.dismiss(toast.key)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.ach-toasts {
  position: fixed;
  z-index: 1080;
  right: 24px;
  bottom: 24px;
  display: flex;
  flex-direction: column-reverse;
  gap: 0.6rem;
  width: min(360px, calc(100vw - 32px));
  pointer-events: none;
}

/* Phones and tablets: the tab bar is at the bottom; compact toasts */
@media (max-width: 991.98px) {
  .ach-toasts {
    top: calc(12px + env(safe-area-inset-top));
    right: 16px;
    bottom: auto;
    flex-direction: column;
    gap: 0.4rem;
  }

  .ach-toast-link {
    padding: 0.6rem 2.5rem 0.6rem 0.6rem;
    gap: 0.7rem;
  }

  .ach-toast-icon {
    width: 40px;
    height: 40px;
    border-radius: 11px;
  }

  .ach-toast-desc {
    display: none;
  }
}

.ach-toast {
  position: relative;
  pointer-events: auto;
  border-radius: var(--pb-radius-md);
  border: 1px solid transparent;
  background:
    linear-gradient(var(--pb-bg-elevated), var(--pb-bg-elevated)) padding-box,
    var(--pb-holo) border-box;
  box-shadow: var(--pb-shadow-lg);
  overflow: hidden;
}

/* A foil glint sweeps across once as it lands */
.ach-toast::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(105deg, transparent 35%, color-mix(in srgb, var(--pb-text) 12%, transparent) 50%, transparent 65%);
  transform: translateX(-100%);
  animation: ach-glint 1.1s 0.35s var(--pb-ease-out) forwards;
  pointer-events: none;
}

.ach-toast-link {
  display: flex;
  gap: 0.85rem;
  align-items: center;
  padding: 0.85rem 2.5rem 0.85rem 0.85rem;
  color: var(--pb-text);
}

.ach-toast-icon {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: 14px;
  background: var(--pb-holo);
  color: var(--pb-accent-ink);
}

.ach-toast-icon svg {
  width: 26px;
  height: 26px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.ach-toast-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 0.1rem;
}

.ach-toast-eyebrow {
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--pb-text-muted);
}

.ach-toast-title {
  font-family: var(--pb-font-display);
  font-size: 1rem;
  font-weight: 700;
  line-height: 1.2;
}

.ach-toast-desc,
.ach-toast-rate {
  font-size: 0.78rem;
  color: var(--pb-text-muted);
}

.ach-toast-rate {
  font-weight: 700;
}

.ach-toast-close {
  position: absolute;
  top: 6px;
  right: 6px;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 50%;
  background: none;
  color: var(--pb-text-muted);
}

.ach-toast-close svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
}

@media (hover: hover) {
  .ach-toast-close:hover {
    color: var(--pb-text);
    background: var(--pb-selected);
  }
}

.ach-toast-enter-active {
  transition:
    transform 0.5s var(--pb-ease-out),
    opacity 0.5s;
}

.ach-toast-leave-active {
  transition:
    transform 0.3s ease-in,
    opacity 0.3s;
}

.ach-toast-enter-from,
.ach-toast-leave-to {
  opacity: 0;
  transform: translateX(110%);
}

@media (max-width: 991.98px) {
  .ach-toast-enter-from,
  .ach-toast-leave-to {
    transform: translateY(-120%);
  }
}

@keyframes ach-glint {
  to {
    transform: translateX(100%);
  }
}
</style>
