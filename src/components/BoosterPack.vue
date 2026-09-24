<script setup>
import { useI18n } from 'vue-i18n'
import BoosterArt from '@/components/BoosterArt.vue'

// The pack you tear open. Rendered as two stacked copies of the artwork,
// clipped along a zigzag tear line: the top strip flies off, the body drops.
// Tear duration is TEAR_MS; the parent waits that long before revealing.
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
export const TEAR_MS = 1000
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
    <span class="pack-glow" aria-hidden="true"></span>
    <span class="pack-part pack-body" :style="{ clipPath: bodyClip }">
      <BoosterArt :logo="logo" :artwork="artwork" :symbol="symbol" :name="name" />
    </span>
    <span class="pack-part pack-strip" :style="{ clipPath: stripClip }">
      <BoosterArt :logo="logo" :artwork="artwork" :symbol="symbol" :name="name" />
    </span>
  </button>
</template>

<style scoped>
.booster-pack {
  --booster-w: clamp(190px, 50vw, 250px);
  position: relative;
  display: block;
  width: var(--booster-w);
  aspect-ratio: 5 / 8;
  padding: 0;
  border: none;
  background: none;
  perspective: 1000px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.booster-pack:focus-visible {
  outline-offset: 10px;
  border-radius: 20px;
}

.booster-pack:disabled {
  cursor: default;
}

.pack-part {
  position: absolute;
  inset: 0;
  display: block;
}

/* Soft holo halo behind the pack */
.pack-glow {
  position: absolute;
  inset: 10% -10%;
  border-radius: 50%;
  background: var(--pb-holo);
  filter: blur(40px);
  opacity: 0.35;
  transition: opacity 0.4s;
}

/* Drawing: breathe (the original prototype's pulse) */
.is-loading .pack-part {
  animation: pulse 1.6s ease-in-out infinite;
}

/* Ready: float, with a little shake now and then inviting a tap */
.is-ready {
  animation: pack-float 4s ease-in-out infinite;
}

.is-ready .pack-part {
  animation: pack-nudge 3.2s ease-in-out infinite;
}

.is-ready:hover .pack-glow,
.is-ready:focus-visible .pack-glow {
  opacity: 0.6;
}

/* Tearing: strip flies away, then the body drops as the cards come out */
.is-tearing .pack-strip {
  animation: tear-strip 0.7s cubic-bezier(0.3, 0, 0.6, 1) forwards;
}

.is-tearing .pack-body {
  animation: tear-body 0.6s 0.4s ease-in forwards;
}

.is-tearing .pack-glow {
  animation: tear-flash 1s ease-out forwards;
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

@keyframes tear-strip {
  0% {
    transform: none;
  }
  25% {
    transform: translate(2%, -2%) rotate(3deg);
  }
  100% {
    transform: translate(60%, -140%) rotate(35deg);
    opacity: 0;
  }
}

@keyframes tear-body {
  to {
    transform: translateY(45%) scale(0.92);
    opacity: 0;
  }
}

@keyframes tear-flash {
  30% {
    opacity: 0.9;
    transform: scale(1.3);
  }
  100% {
    opacity: 0;
    transform: scale(1.6);
  }
}
</style>
