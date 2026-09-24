<script setup>
import { reactive, ref } from 'vue'
import { tiltFromPointer } from '@/utils/tilt'

// A card image with a 3D tilt and holographic foil shine that follow the
// pointer. Reusable anywhere a card should feel "premium" (hero, rare pulls).
const props = defineProps({
  src: { type: String, required: true },
  srcset: { type: String, default: null },
  sizes: { type: String, default: null },
  alt: { type: String, required: true },
  maxTilt: { type: Number, default: 14 },
  eager: { type: Boolean, default: false },
})

const el = ref(null)
const pose = reactive({ rx: 0, ry: 0, mx: 50, my: 50, active: false })

function onPointerMove(event) {
  const rect = el.value.getBoundingClientRect()
  Object.assign(
    pose,
    tiltFromPointer(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height, props.maxTilt),
    { active: true },
  )
}

function onPointerLeave() {
  Object.assign(pose, { rx: 0, ry: 0, mx: 50, my: 50, active: false })
}
</script>

<template>
  <div
    ref="el"
    class="holo-card"
    :class="{ active: pose.active }"
    :style="{
      '--rx': `${pose.rx}deg`,
      '--ry': `${pose.ry}deg`,
      '--mx': `${pose.mx}%`,
      '--my': `${pose.my}%`,
    }"
    @pointermove="onPointerMove"
    @pointerleave="onPointerLeave"
  >
    <div class="holo-card-inner">
      <img
        :src="src"
        :srcset="srcset"
        :sizes="sizes"
        :alt="alt"
        draggable="false"
        :loading="eager ? 'eager' : 'lazy'"
        decoding="async"
      />
      <div class="holo-shine" aria-hidden="true"></div>
      <div class="holo-glare" aria-hidden="true"></div>
    </div>
  </div>
</template>

<style scoped>
.holo-card {
  perspective: 900px;
  aspect-ratio: 63 / 88;
}

.holo-card-inner {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 4.5% / 3.2%;
  overflow: hidden;
  transform: rotateX(var(--rx)) rotateY(var(--ry));
  transform-style: preserve-3d;
  box-shadow: var(--pb-shadow-card);
  transition: transform 0.5s var(--pb-ease-out);
}

.holo-card.active .holo-card-inner {
  transition: transform 0.08s linear;
}

.holo-card img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  user-select: none;
}

/* Rainbow foil band that slides with the pointer */
.holo-shine {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    115deg,
    transparent 20%,
    rgba(110, 231, 249, 0.55) 36%,
    rgba(167, 139, 250, 0.55) 44%,
    rgba(244, 114, 182, 0.55) 52%,
    rgba(252, 211, 77, 0.55) 60%,
    transparent 76%
  );
  background-size: 250% 250%;
  background-position: var(--mx) var(--my);
  mix-blend-mode: color-dodge;
  opacity: 0;
  transition: opacity 0.4s;
}

/* Soft light spot under the pointer */
.holo-glare {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at var(--mx) var(--my), rgba(255, 255, 255, 0.45), transparent 55%);
  mix-blend-mode: overlay;
  opacity: 0;
  transition: opacity 0.4s;
}

.holo-card.active .holo-shine {
  opacity: 0.7;
}

.holo-card.active .holo-glare {
  opacity: 1;
}
</style>
