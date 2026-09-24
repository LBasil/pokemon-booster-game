<script setup>
import { useI18n } from 'vue-i18n'
import { rarityTier } from '@/utils/rarity'

// Face-down pile of a pack's cards. Each tap flips the next card face-up;
// the previous one flies off to the side. The parent owns revealedCount.
const props = defineProps({
  // [{ key, card, isNew }]
  cards: { type: Array, required: true },
  revealedCount: { type: Number, required: true },
})

defineEmits(['tap'])

const { t } = useI18n()

function stateOf(index) {
  if (index < props.revealedCount - 1) return 'gone'
  if (index === props.revealedCount - 1) return 'current'
  return 'waiting'
}
</script>

<template>
  <button
    type="button"
    class="card-stack"
    :aria-label="revealedCount < cards.length ? t('boosters.tapToReveal') : t('boosters.tapToContinue')"
    @click="$emit('tap')"
  >
    <span
      v-for="(item, index) in cards"
      :key="item.key"
      class="stack-card"
      :class="`is-${stateOf(index)}`"
      :data-tier="rarityTier(item.card.rarity)"
      :style="{
        '--depth': Math.min(Math.max(index - revealedCount, 0), 5),
        zIndex: stateOf(index) === 'waiting' ? cards.length - index : cards.length + 1,
      }"
    >
      <span class="stack-card-glow" aria-hidden="true"></span>
      <span class="stack-card-flip">
        <span class="face face-back" aria-hidden="true">
          <svg viewBox="0 0 32 32"><path d="M16 3l3 9.5 9.5 3.5-9.5 3.5L16 29l-3-9.5L3.5 16l9.5-3.5z" /></svg>
        </span>
        <span class="face face-front">
          <img
            :src="item.card.image_small || item.card.image_url"
            :srcset="item.card.image_small && item.card.image_url ? `${item.card.image_small} 245w, ${item.card.image_url} 734w` : null"
            sizes="(max-width: 576px) 68vw, 300px"
            :alt="stateOf(index) === 'current' ? item.card.name : ''"
            draggable="false"
          />
          <span class="face-shine" aria-hidden="true"></span>
        </span>
      </span>
    </span>
  </button>
</template>

<style scoped>
.card-stack {
  --card-w: min(68vw, 300px);
  position: relative;
  display: block;
  width: var(--card-w);
  aspect-ratio: 63 / 88;
  padding: 0;
  border: none;
  background: none;
  cursor: pointer;
  perspective: 1200px;
  -webkit-tap-highlight-color: transparent;
}

.card-stack:focus-visible {
  outline-offset: 10px;
  border-radius: 18px;
}

.stack-card {
  position: absolute;
  inset: 0;
  display: block;
  transition:
    transform 0.55s var(--pb-ease-out),
    opacity 0.45s ease;
  /* Cards still in the pile fan slightly so it reads as a stack */
  transform: translate(calc(var(--depth) * 3px), calc(var(--depth) * -3px));
  animation: deal-in 0.6s var(--pb-ease-out) backwards;
  animation-delay: calc(var(--depth) * 40ms);
}

.stack-card.is-gone {
  transform: translateX(-125%) translateY(4%) rotate(-16deg);
  opacity: 0;
  pointer-events: none;
}

.stack-card-flip {
  position: absolute;
  inset: 0;
  display: block;
  transform-style: preserve-3d;
  transform: rotateY(180deg);
  transition: transform 0.6s var(--pb-ease-out);
}

.is-current .stack-card-flip,
.is-gone .stack-card-flip {
  transform: rotateY(0);
}

.face {
  position: absolute;
  inset: 0;
  display: block;
  border-radius: 4.5% / 3.2%;
  overflow: hidden;
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  box-shadow: var(--pb-shadow-card);
}

.face-front img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  user-select: none;
}

/* Card back: our own design, not the official one */
.face-back {
  transform: rotateY(180deg);
  display: grid;
  place-items: center;
  background:
    radial-gradient(circle at 50% 50%, rgba(167, 139, 250, 0.45), transparent 45%),
    repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.04) 0 6px, transparent 6px 12px),
    linear-gradient(160deg, #1d2450, #0a0d1a);
  border: 6px solid transparent;
  background-clip: padding-box;
  outline: 2px solid rgba(255, 255, 255, 0.12);
  outline-offset: -12px;
}

.face-back::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 5px;
  background: var(--pb-holo);
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  opacity: 0.8;
}

.face-back svg {
  width: 34%;
  fill: #fcd34d;
  filter: drop-shadow(0 0 14px rgba(252, 211, 77, 0.55));
}

/* Foil sweep on rare fronts */
.face-shine {
  position: absolute;
  inset: 0;
  opacity: 0;
  background: linear-gradient(
    115deg,
    transparent 30%,
    rgba(110, 231, 249, 0.5) 42%,
    rgba(244, 114, 182, 0.5) 50%,
    rgba(252, 211, 77, 0.5) 58%,
    transparent 70%
  );
  background-size: 300% 100%;
  mix-blend-mode: color-dodge;
}

.is-current[data-tier='rare'] .face-shine,
.is-current[data-tier='ultra'] .face-shine {
  animation: foil-sweep 2.4s 0.4s ease-in-out infinite;
}

@keyframes foil-sweep {
  0% {
    opacity: 0.8;
    background-position: 100% 0;
  }
  60%,
  100% {
    opacity: 0.8;
    background-position: -100% 0;
  }
}

/* Halo behind rare pulls */
.stack-card-glow {
  position: absolute;
  inset: -6%;
  border-radius: 12%;
  background: var(--pb-holo);
  filter: blur(26px);
  opacity: 0;
  transition: opacity 0.5s 0.3s;
}

.is-current[data-tier='rare'] .stack-card-glow {
  opacity: 0.55;
}

.is-current[data-tier='ultra'] .stack-card-glow {
  inset: -9%;
  opacity: 0.9;
  animation: ultra-pulse 1.8s ease-in-out infinite;
}

@keyframes ultra-pulse {
  50% {
    transform: scale(1.06);
    filter: blur(34px);
  }
}

@keyframes deal-in {
  from {
    opacity: 0;
    transform: translateY(40%) scale(0.9);
  }
}
</style>
