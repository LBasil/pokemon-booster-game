<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'

// A small burst of holo sparks on each click / tap, mounted once in App.vue.
// Nothing runs with prefers-reduced-motion or Profile > Settings > Visual effects off.
const NO_SPARKS = 'input, textarea, select, [contenteditable]'
const SPARKS = 7

const sparks = ref([])
let sparkId = 0

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

function start() {
  if (enabled.value) return
  enabled.value = true
  window.addEventListener('pointerdown', onDown, { passive: true })
}

function stop() {
  enabled.value = false
  sparks.value = []
  window.removeEventListener('pointerdown', onDown)
}

onMounted(() => {
  reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
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
.fx-spark {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 9999;
  width: 5px;
  height: 5px;
  margin: -2.5px 0 0 -2.5px;
  border-radius: 50%;
  pointer-events: none;
  background: var(--pb-holo);
  filter: hue-rotate(var(--hue));
  animation: fx-spark 0.55s var(--pb-ease-out) forwards;
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
