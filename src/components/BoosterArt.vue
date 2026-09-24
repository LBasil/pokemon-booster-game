<script setup>
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

// Booster pack in the design system's foil style (pure CSS + set artwork).
// Without a logo it renders the generic "any set" pack.
// Size it with the --booster-w custom property on a parent.
const props = defineProps({
  // Set logo (transparent PNG) shown at the top of the pack
  logo: { type: String, default: null },
  // Card image whose illustration fills the pack window
  artwork: { type: String, default: null },
  // Set symbol shown in the footer
  symbol: { type: String, default: null },
  name: { type: String, default: null },
})

const { t } = useI18n()

// Some older sets have no logo on the CDN; fall back to the set name
const logoFailed = ref(false)
const artworkFailed = ref(false)
watch(
  () => props.logo,
  () => (logoFailed.value = false),
)
watch(
  () => props.artwork,
  () => (artworkFailed.value = false),
)
</script>

<template>
  <div class="booster-art" :class="{ 'is-set': logo || name }" aria-hidden="true">
    <div class="booster-crimp"></div>

    <div v-if="logo || name" class="booster-body">
      <div class="booster-logo">
        <img v-if="logo && !logoFailed" :src="logo" alt="" @error="logoFailed = true" />
        <span v-else class="booster-logo-text">{{ name }}</span>
      </div>
      <div class="booster-window">
        <img
          v-if="artwork && !artworkFailed"
          :src="artwork"
          alt=""
          class="booster-window-art"
          @error="artworkFailed = true"
        />
        <svg v-else class="booster-mark" viewBox="0 0 32 32">
          <path d="M16 3l3 9.5 9.5 3.5-9.5 3.5L16 29l-3-9.5L3.5 16l9.5-3.5z" />
        </svg>
      </div>
      <div class="booster-footer">
        <img v-if="symbol" :src="symbol" alt="" class="booster-symbol" />
        <span>{{ t('common.boosterCount', { count: 10 }) }}</span>
      </div>
    </div>

    <div v-else class="booster-body booster-body-generic">
      <svg class="booster-mark" viewBox="0 0 32 32">
        <path d="M16 3l3 9.5 9.5 3.5-9.5 3.5L16 29l-3-9.5L3.5 16l9.5-3.5z" />
      </svg>
      <span class="booster-label">{{ t('common.booster') }}</span>
    </div>

    <div class="booster-crimp"></div>
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
  flex-shrink: 0;
  background:
    repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.18) 0 2px, transparent 2px 6px),
    rgba(10, 13, 26, 0.25);
}

.booster-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  margin: 0 7%;
  padding: 6% 6% 5%;
  border-radius: calc(var(--w) * 0.04);
  background:
    radial-gradient(100% 60% at 50% 45%, rgba(167, 139, 250, 0.35), transparent 70%),
    rgba(10, 13, 26, 0.88);
}

.booster-body-generic {
  justify-content: center;
  gap: 8%;
  padding: 0;
}

.booster-logo {
  position: relative;
  z-index: 1;
  height: 22%;
  width: 100%;
  display: grid;
  place-items: center;
}

.booster-logo img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.6));
}

.booster-logo-text {
  font-family: var(--pb-font-display);
  font-weight: 800;
  font-size: calc(var(--w) * 0.085);
  line-height: 1.1;
  text-align: center;
  color: #fff;
  overflow-wrap: anywhere;
}

/* Square window cropped onto the card's illustration area */
.booster-window {
  position: relative;
  flex: 1;
  min-height: 0;
  width: 100%;
  margin-top: 4%;
  border-radius: calc(var(--w) * 0.035);
  overflow: hidden;
  display: grid;
  place-items: center;
  box-shadow:
    inset 0 0 0 2px rgba(255, 255, 255, 0.25),
    0 6px 16px rgba(0, 0, 0, 0.5);
}

/* Zoom onto the illustration box (roughly the upper-middle of a card) */
.booster-window-art {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: 50% 22%;
  transform: scale(1.7);
  transform-origin: 50% 24%;
}

.booster-footer {
  display: flex;
  align-items: center;
  gap: 6%;
  margin-top: 5%;
  font-size: calc(var(--w) * 0.055);
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.85);
  white-space: nowrap;
}

.booster-symbol {
  height: calc(var(--w) * 0.075);
  width: auto;
  filter: drop-shadow(0 0 3px rgba(255, 255, 255, 0.5));
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
  pointer-events: none;
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
