<script setup>
import { computed, reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import { rarityTier } from '@/utils/rarity'

// Face-down pile of a pack's cards. Each tap flips the next card face-up and
// throws the previous one aside; on touch screens the face-up card can also
// be swiped away (it flies off in the swipe's direction). Hits "charge up"
// before flipping. The parent owns revealedCount and advances on `tap`.
const props = defineProps({
  // [{ key, card, isNew }]
  cards: { type: Array, required: true },
  revealedCount: { type: Number, required: true },
})

const emit = defineEmits(['tap'])

const { t } = useI18n()

const SWIPE_THRESHOLD = 70 // px before a drag counts as a throw
const HIT_LOCK_MS = 1100 // taps are ignored while a hit charges and flips

function stateOf(index) {
  if (index < props.revealedCount - 1) return 'gone'
  if (index === props.revealedCount - 1) return 'current'
  return 'waiting'
}

const current = computed(() => props.cards[props.revealedCount - 1] ?? null)

// Which way each thrown card flew (-1 left, 1 right)
const throwDir = reactive({})
const drag = reactive({ active: false, startX: 0, dx: 0 })
let suppressClick = false
let lockedUntil = 0

function advance(direction) {
  if (Date.now() < lockedUntil) return
  if (current.value) throwDir[current.value.key] = direction
  const next = props.cards[props.revealedCount]
  if (next && rarityTier(next.card) === 'ultra') lockedUntil = Date.now() + HIT_LOCK_MS
  emit('tap')
}

function onPointerDown(event) {
  if (!current.value || (event.pointerType === 'mouse' && event.button !== 0)) return
  drag.active = true
  drag.startX = event.clientX
  drag.dx = 0
}

function onPointerMove(event) {
  if (drag.active) drag.dx = event.clientX - drag.startX
}

function onPointerUp() {
  if (!drag.active) return
  drag.active = false
  const dx = drag.dx
  drag.dx = 0
  if (Math.abs(dx) > 8) suppressClick = true // a drag, not a tap
  if (Math.abs(dx) > SWIPE_THRESHOLD) advance(Math.sign(dx))
}

function onClick() {
  if (suppressClick) {
    suppressClick = false
    return
  }
  advance(-1)
}

const label = computed(() =>
  props.revealedCount < props.cards.length ? t('boosters.tapToReveal') : t('boosters.tapToContinue'),
)

function styleOf(item, index) {
  const state = stateOf(index)
  const style = {
    '--depth': Math.min(Math.max(index - props.revealedCount, 0), 5),
    '--dir': throwDir[item.key] ?? -1,
    zIndex: state === 'waiting' ? props.cards.length - index : props.cards.length + 1,
  }
  if (state === 'current' && drag.dx) {
    style.transform = `translateX(${drag.dx}px) rotate(${drag.dx / 14}deg)`
  }
  return style
}
</script>

<template>
  <button
    type="button"
    class="card-stack"
    :aria-label="label"
    @click="onClick"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <span
      v-for="(item, index) in cards"
      :key="item.key"
      class="stack-card"
      :class="[`is-${stateOf(index)}`, { 'is-dragging': drag.active && stateOf(index) === 'current' }]"
      :data-tier="rarityTier(item.card)"
      :style="styleOf(item, index)"
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
      <span class="stack-card-flash" aria-hidden="true"></span>
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
  /* Vertical scrolling still works; horizontal drags throw the card */
  touch-action: pan-y;
  user-select: none;
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
  will-change: transform;
  transition:
    transform 0.55s var(--pb-ease-out),
    opacity 0.45s ease;
  /* Cards still in the pile fan slightly so it reads as a stack */
  transform: translate(calc(var(--depth) * 3px), calc(var(--depth) * -3px));
}

.stack-card.is-dragging {
  transition: none;
}

/* Thrown aside in the swipe direction (left by default), with a little arc */
.stack-card.is-gone {
  transform: translateX(calc(var(--dir) * 135%)) translateY(-8%) rotate(calc(var(--dir) * 22deg));
  opacity: 0;
  pointer-events: none;
  transition:
    transform 0.5s cubic-bezier(0.3, 0.6, 0.4, 1),
    opacity 0.4s 0.1s ease;
}

.stack-card-flip {
  position: absolute;
  inset: 0;
  display: block;
  transform-style: preserve-3d;
  transform: rotateY(180deg);
}

.is-gone .stack-card-flip {
  transform: rotateY(0);
}

/* Flip with a lift: the card rises toward you as it turns */
.is-current .stack-card-flip {
  transform: rotateY(0);
  animation: flip-reveal 0.6s var(--pb-ease-out) backwards;
}

/* Hits charge up face-down (shake + glow), then flip with a flash */
.is-current[data-tier='ultra'] .stack-card-flip {
  animation:
    flip-reveal 0.6s 0.55s var(--pb-ease-out) backwards,
    charge 0.55s ease-in;
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
  pointer-events: none;
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

.is-current[data-tier='rare'] .face-shine {
  animation: foil-sweep 2.4s 0.5s ease-in-out infinite;
}

.is-current[data-tier='ultra'] .face-shine {
  animation: foil-sweep 2.4s 1.1s ease-in-out infinite;
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
  transition: opacity 0.4s;
  animation: ultra-pulse 1.8s 1.1s ease-in-out infinite;
}

/* White burst as a hit turns over */
.stack-card-flash {
  position: absolute;
  inset: -20%;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0) 60%);
  opacity: 0;
  pointer-events: none;
}

.is-current[data-tier='ultra'] .stack-card-flash {
  animation: flash 0.6s 0.7s ease-out;
}

@keyframes flip-reveal {
  0% {
    transform: rotateY(180deg);
  }
  45% {
    transform: translateY(-5%) scale(1.08) rotateY(90deg);
  }
  100% {
    transform: rotateY(0);
  }
}

@keyframes charge {
  0% {
    transform: rotateY(180deg);
  }
  20% {
    transform: rotateY(180deg) translateX(-1.5%) rotate(-1.5deg);
  }
  40% {
    transform: rotateY(180deg) translateX(1.5%) rotate(1.5deg);
  }
  60% {
    transform: rotateY(180deg) translateX(-2%) rotate(-2deg) scale(1.02);
  }
  80% {
    transform: rotateY(180deg) translateX(2%) rotate(2deg) scale(1.04);
  }
  100% {
    transform: rotateY(180deg) scale(1.05);
  }
}

@keyframes flash {
  0% {
    opacity: 0;
    transform: scale(0.6);
  }
  30% {
    opacity: 0.9;
  }
  100% {
    opacity: 0;
    transform: scale(1.2);
  }
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

@keyframes ultra-pulse {
  50% {
    transform: scale(1.05);
  }
}
</style>
