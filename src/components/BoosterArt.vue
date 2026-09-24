<script setup>
import { useI18n } from 'vue-i18n'

// Decorative booster pack in the design system's foil style (pure CSS, no image).
// Size it with the --booster-w custom property on a parent.
const { t } = useI18n()
</script>

<template>
  <div class="booster-art" aria-hidden="true">
    <div class="booster-crimp booster-crimp-top"></div>
    <div class="booster-body">
      <svg class="booster-mark" viewBox="0 0 32 32">
        <path d="M16 3l3 9.5 9.5 3.5-9.5 3.5L16 29l-3-9.5L3.5 16l9.5-3.5z" />
      </svg>
      <span class="booster-label">{{ t('common.booster') }}</span>
    </div>
    <div class="booster-crimp booster-crimp-bottom"></div>
    <div class="booster-sheen"></div>
  </div>
</template>

<style scoped>
.booster-art {
  --w: var(--booster-w, 140px);
  position: relative;
  width: var(--w);
  aspect-ratio: 5 / 8;
  display: flex;
  flex-direction: column;
  border-radius: calc(var(--w) * 0.06);
  overflow: hidden;
  background:
    radial-gradient(120% 60% at 30% 20%, rgba(255, 255, 255, 0.35), transparent 60%),
    linear-gradient(160deg, #6ee7f9 0%, #a78bfa 40%, #f472b6 70%, #fcd34d 100%);
  box-shadow:
    var(--pb-shadow-card),
    inset 0 0 0 1px rgba(255, 255, 255, 0.35);
}

/* Heat-sealed ridges at both ends of the wrapper */
.booster-crimp {
  height: 9%;
  background:
    repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.18) 0 2px, transparent 2px 6px),
    rgba(10, 13, 26, 0.25);
}

.booster-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8%;
  margin: 0 8%;
  border-radius: calc(var(--w) * 0.04);
  background: rgba(10, 13, 26, 0.82);
}

.booster-mark {
  width: 42%;
  fill: #fcd34d;
  filter: drop-shadow(0 0 10px rgba(252, 211, 77, 0.6));
}

.booster-label {
  font-family: var(--pb-font-display);
  font-weight: 800;
  font-size: calc(var(--w) * 0.1);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #fff;
}

.booster-sheen {
  position: absolute;
  inset: 0;
  background: linear-gradient(115deg, transparent 35%, rgba(255, 255, 255, 0.45) 50%, transparent 65%);
  background-size: 250% 100%;
  animation: booster-sheen 4.5s ease-in-out infinite;
  mix-blend-mode: overlay;
}

@keyframes booster-sheen {
  0%,
  30% {
    background-position: 120% 0;
  }
  70%,
  100% {
    background-position: -120% 0;
  }
}
</style>
