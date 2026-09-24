<script setup>
import { useI18n } from 'vue-i18n'
import BoosterArt from '@/components/BoosterArt.vue'

// The pack you tear open. Rendered as two stacked copies of the artwork,
// clipped along a zigzag tear line: the strip peels off left to right and
// flies away, a card rises out of the opening, then the pack drops away.
// The parent waits TEAR_MS before swapping in the card pile.
defineProps({
  // loading: cards still being drawn | ready: waiting for a tap | tearing
  state: { type: String, default: 'ready' },
  logo: { type: String, default: null },
  artwork: { type: String, default: null },
  symbol: { type: String, default: null },
  name: { type: String, default: null },
})

defineEmits(['open'])

const { t } = useI18n()

const TEETH = 12
const TEAR_TOP = 11
const TEAR_BOTTOM = 15
// Points of the tear line, left to right
const tearLine = Array.from({ length: TEETH * 2 + 1 }, (_, i) => {
  const x = (i / (TEETH * 2)) * 100
  return `${x}% ${i % 2 ? TEAR_BOTTOM : TEAR_TOP}%`
})

const stripClip = `polygon(0 0, 100% 0, ${[...tearLine].reverse().join(', ')})`
const bodyClip = `polygon(${tearLine.join(', ')}, 100% 100%, 0 100%)`
</script>

<script>
export const TEAR_MS = 1300
</script>

<template>
  <button
    type="button"
    class="booster-pack"
    :class="`is-${state}`"
    :disabled="state !== 'ready'"
    :aria-label="t('boosters.tapToOpen')"
    @click="$emit('open')"
  >
    <!-- Floating lives on a wrapper that is paused (not removed) when tearing,
         so the pack doesn't jump back to its resting position -->
    <span class="pack-float">
      <span class="pack-glow" aria-hidden="true"></span>
      <span class="pack-shake">
        <span class="pack-peek" aria-hidden="true">
          <svg viewBox="0 0 32 32"><path d="M16 3l3 9.5 9.5 3.5-9.5 3.5L16 29l-3-9.5L3.5 16l9.5-3.5z" /></svg>
        </span>
        <span class="pack-part pack-body" :style="{ clipPath: bodyClip }">
          <BoosterArt :logo="logo" :artwork="artwork" :symbol="symbol" :name="name" />
        </span>
        <span class="pack-part pack-strip" :style="{ clipPath: stripClip }">
          <BoosterArt :logo="logo" :artwork="artwork" :symbol="symbol" :name="name" />
        </span>
      </span>
    </span>
  </button>
</template>

<style scoped>
.booster-pack {
  --booster-w: min(60vw, 260px);
  position: relative;
  display: block;
  width: var(--booster-w);
  aspect-ratio: 5 / 8;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}

.booster-pack:focus-visible {
  outline-offset: 10px;
  border-radius: 20px;
}

.booster-pack:disabled {
  cursor: default;
}

.pack-float,
.pack-shake,
.pack-part {
  position: absolute;
  inset: 0;
  display: block;
}

.pack-part,
.pack-peek {
  will-change: transform, opacity;
}

/* Soft holo halo behind the pack (only its opacity is ever animated) */
.pack-glow {
  position: absolute;
  inset: 10% -10%;
  border-radius: 50%;
  background: var(--pb-holo);
  filter: blur(40px);
  opacity: 0.35;
  transition: opacity 0.4s;
}

/* A face-down card waiting inside the pack, revealed by the tear */
.pack-peek {
  position: absolute;
  left: 9%;
  right: 9%;
  top: 8%;
  aspect-ratio: 63 / 88;
  display: grid;
  place-items: center;
  border-radius: 6% / 4.3%;
  /* Same holo-rimmed back as the pile's cards, so it reads on a dark page */
  border: 4px solid transparent;
  background:
    radial-gradient(circle at 50% 50%, rgba(167, 139, 250, 0.45), transparent 45%) padding-box,
    linear-gradient(160deg, #1d2450, #0a0d1a) padding-box,
    var(--pb-holo) border-box;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.5);
  opacity: 0;
}

.pack-peek svg {
  width: 32%;
  fill: #fcd34d;
}

/* ---------- Drawing: breathe (the original prototype's pulse) ---------- */

.is-loading .pack-shake {
  animation: pulse 1.6s ease-in-out infinite;
}

/* ---------- Ready: float, with a little nudge now and then ---------- */

.pack-float {
  animation: pack-float 4s ease-in-out infinite;
}

.is-loading .pack-float {
  animation-play-state: paused;
}

.is-ready .pack-shake {
  animation: pack-nudge 3.2s ease-in-out infinite;
}

@media (hover: hover) {
  .is-ready:hover .pack-glow {
    opacity: 0.6;
  }
}

.is-ready:focus-visible .pack-glow {
  opacity: 0.6;
}

/* ---------- Tearing (1.3s) ---------- */

.is-tearing .pack-float {
  animation-play-state: paused;
}

/* 0-150ms: grip — a small squeeze before the rip */
.is-tearing .pack-shake {
  animation: pack-grip 0.5s ease-out;
}

/* 150-850ms: strip peels from the left, hinged on its right end, then flies off */
.is-tearing .pack-strip {
  transform-origin: 100% 13%;
  animation: tear-strip 0.7s 0.15s cubic-bezier(0.4, 0, 0.7, 1) forwards;
}

/* 550-1000ms: a card rises out of the opening, then settles at the exact
   size and spot of the pile's top card (1.4x), so the handoff is seamless */
.is-tearing .pack-peek {
  animation:
    peek-rise 0.45s 0.55s var(--pb-ease-out) forwards,
    peek-settle 0.3s 1s ease-in-out forwards;
}

/* 900-1300ms: the wrapper drops away, the pile takes over in place */
.is-tearing .pack-body {
  animation: tear-body 0.4s 0.9s ease-in forwards;
}

.is-tearing .pack-glow {
  animation: tear-flash 1.3s ease-out forwards;
}

/* Keep the sheen from repainting both halves while they move */
.is-tearing :deep(.booster-sheen) {
  animation: none;
  opacity: 0;
}

@keyframes pulse {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.04);
  }
}

@keyframes pack-float {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-10px);
  }
}

@keyframes pack-nudge {
  0%,
  80%,
  100% {
    transform: rotate(0);
  }
  84% {
    transform: rotate(-3deg);
  }
  88% {
    transform: rotate(3deg);
  }
  92% {
    transform: rotate(-2deg);
  }
  96% {
    transform: rotate(1deg);
  }
}

@keyframes pack-grip {
  0% {
    transform: none;
  }
  30% {
    transform: scale(0.97, 0.99);
  }
  45% {
    transform: translateX(-1.5%) rotate(-1deg);
  }
  60% {
    transform: translateX(1.5%) rotate(1deg);
  }
  100% {
    transform: none;
  }
}

@keyframes tear-strip {
  0% {
    transform: none;
  }
  /* Left end lifts first: the rip travels along the teeth */
  45% {
    transform: translateY(-3%) rotate(-7deg);
  }
  60% {
    transform: translate(2%, -6%) rotate(-9deg);
    opacity: 1;
  }
  100% {
    transform: translate(45%, -55%) rotate(18deg);
    opacity: 0;
  }
}

@keyframes peek-rise {
  from {
    opacity: 1;
    transform: translateY(0);
  }
  to {
    opacity: 1;
    transform: translateY(-22%);
  }
}

/* Out of the pack, the card moves in front of it (z-index) so the fading
   wrapper never shows through */
@keyframes peek-settle {
  0% {
    z-index: 2;
  }
  100% {
    z-index: 2;
    opacity: 1;
    transform: translateY(9%) scale(1.4);
  }
}

@keyframes tear-body {
  to {
    transform: translateY(35%);
    opacity: 0;
  }
}

@keyframes tear-flash {
  20% {
    opacity: 0.35;
  }
  45% {
    opacity: 0.9;
  }
  100% {
    opacity: 0;
  }
}
</style>
