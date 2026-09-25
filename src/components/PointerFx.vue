<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'

// Light pointer effects, mounted once in App.vue:
// - mouse only: a soft aurora glow behind the content (it lights up the glass
//   panels from below) + a holo ring trailing the native cursor, which grows
//   over anything clickable. The native cursor stays: precision first.
// - mouse and touch: a small burst of holo sparks on each click / tap.
// Nothing runs with prefers-reduced-motion or Profile > Settings > Visual effects off.
const HOT = 'a, button, [role="button"], [role="tab"], label, select, summary, .holo-card'
const NO_SPARKS = 'input, textarea, select, [contenteditable]'
const SPARKS = 7

const glow = ref(null)
const ring = ref(null)
const hot = ref(false)
const visible = ref(false)
const sparks = ref([])

const target = { x: -500, y: -500 }
const pos = { x: -500, y: -500 }
let frame = 0
let sparkId = 0

function tick() {
  if (!ring.value) {
    frame = 0
    return
  }
  // The ring trails the pointer (lerp); the glow simply follows it
  pos.x += (target.x - pos.x) * 0.25
  pos.y += (target.y - pos.y) * 0.25
  ring.value.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`
  glow.value.style.transform = `translate3d(${target.x}px, ${target.y}px, 0)`
  const settled = Math.abs(target.x - pos.x) < 0.2 && Math.abs(target.y - pos.y) < 0.2
  frame = settled ? 0 : requestAnimationFrame(tick)
}

function onMove(event) {
  if (event.pointerType !== 'mouse') return
  target.x = event.clientX
  target.y = event.clientY
  if (!visible.value) {
    // First move (or back in the window): no fly-in from the old spot
    pos.x = target.x
    pos.y = target.y
    visible.value = true
  }
  hot.value = !!event.target.closest?.(HOT)
  if (!frame) frame = requestAnimationFrame(tick)
}

function onLeave(event) {
  if (!event.relatedTarget) visible.value = false
}

function onDown(event) {
  if (event.button > 0 || event.target.closest?.(NO_SPARKS)) return
  const burst = Array.from({ length: SPARKS }, (_, i) => {
    const angle = (i / SPARKS) * Math.PI * 2 + Math.random() * 0.6
    const distance = 18 + Math.random() * 18
    return {
      id: ++sparkId,
      style: {
        left: `${event.clientX}px`,
        top: `${event.clientY}px`,
        '--dx': `${Math.cos(angle) * distance}px`,
        '--dy': `${Math.sin(angle) * distance}px`,
        '--hue': `${Math.round(Math.random() * 360)}deg`,
      },
    }
  })
  sparks.value.push(...burst)
}

const removeSpark = (id) => {
  sparks.value = sparks.value.filter((spark) => spark.id !== id)
}

const settings = useSettingsStore()
const enabled = ref(false)
let reduced = true
let mouse = false

function start() {
  if (enabled.value) return
  enabled.value = true
  if (mouse) {
    window.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('mouseout', onLeave)
  }
  window.addEventListener('pointerdown', onDown, { passive: true })
}

function stop() {
  enabled.value = false
  visible.value = false
  sparks.value = []
  cancelAnimationFrame(frame)
  frame = 0
  window.removeEventListener('pointermove', onMove)
  document.removeEventListener('mouseout', onLeave)
  window.removeEventListener('pointerdown', onDown)
}

onMounted(() => {
  reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  mouse = window.matchMedia('(hover: hover) and (pointer: fine)').matches
  if (!reduced && settings.effects) start()
})

watch(
  () => settings.effects,
  (on) => (on && !reduced ? start() : stop()),
)

onBeforeUnmount(stop)
</script>

<template>
  <div v-if="enabled" class="pointer-fx" aria-hidden="true">
    <div ref="glow" class="fx-glow" :class="{ 'is-visible': visible }" />
    <div ref="ring" class="fx-ring" :class="{ 'is-visible': visible, 'is-hot': hot }"><span /></div>
    <span
      v-for="spark in sparks"
      :key="spark.id"
      class="fx-spark"
      :style="spark.style"
      @animationend="removeSpark(spark.id)"
    />
  </div>
</template>

<style scoped>
.fx-glow,
.fx-ring,
.fx-spark {
  position: fixed;
  top: 0;
  left: 0;
  pointer-events: none;
}

/* Behind every page (like the aurora in body::before): glass panels blur it */
.fx-glow {
  z-index: -1;
  width: 0;
  height: 0;
  opacity: 0;
  transition: opacity 0.4s;
}

.fx-glow::before {
  content: '';
  position: absolute;
  width: 520px;
  height: 520px;
  margin: -260px 0 0 -260px;
  border-radius: 50%;
  background:
    radial-gradient(closest-side, var(--pb-aurora-2), transparent 70%),
    radial-gradient(closest-side at 35% 40%, var(--pb-aurora-1), transparent 80%);
}

.fx-glow.is-visible {
  opacity: 1;
}

/* Holo ring around the native cursor */
.fx-ring {
  z-index: 9999;
  width: 0;
  height: 0;
  opacity: 0;
  transition: opacity 0.25s;
}

.fx-ring.is-visible {
  opacity: 1;
}

.fx-ring span {
  position: absolute;
  width: 30px;
  height: 30px;
  margin: -15px 0 0 -15px;
  border-radius: 50%;
  background: var(--pb-holo);
  -webkit-mask: radial-gradient(closest-side, transparent calc(100% - 1.5px), #000 calc(100% - 1px));
  mask: radial-gradient(closest-side, transparent calc(100% - 1.5px), #000 calc(100% - 1px));
  opacity: 0.55;
  animation: fx-spin 6s linear infinite;
  transition:
    transform 0.3s var(--pb-ease-out),
    opacity 0.3s;
}

.fx-ring.is-hot span {
  transform: scale(1.6);
  opacity: 0.95;
}

/* Click / tap burst */
.fx-spark {
  z-index: 9999;
  width: 5px;
  height: 5px;
  margin: -2.5px 0 0 -2.5px;
  border-radius: 50%;
  background: var(--pb-holo);
  filter: hue-rotate(var(--hue));
  animation: fx-spark 0.55s var(--pb-ease-out) forwards;
}

@keyframes fx-spin {
  to {
    rotate: 360deg;
  }
}

@keyframes fx-spark {
  from {
    transform: translate(0, 0) scale(1);
    opacity: 1;
  }
  to {
    transform: translate(var(--dx), var(--dy)) scale(0.2);
    opacity: 0;
  }
}
</style>
