<script setup>
import HoloCard from '@/components/HoloCard.vue'

// Showcase cards for the landing page: a mix of vintage and modern favourites.
// Images come straight from the public pokemontcg.io CDN, so the hero renders
// without a Supabase round-trip (and before the visitor is logged in).
const CDN = 'https://images.pokemontcg.io'
const SHOWCASE = [
  { path: 'base1/15', name: 'Venusaur' },
  { path: 'swsh7/215', name: 'Umbreon VMAX' },
  { path: 'base1/4', name: 'Charizard' },
  { path: 'sv3pt5/173', name: 'Pikachu' },
  { path: 'base1/2', name: 'Blastoise' },
]

// Only the front card gets a hi-res source (~800 kB each), to keep the landing light
const cards = SHOWCASE.map((card, index) => {
  const offset = index - Math.floor(SHOWCASE.length / 2)
  return {
    ...card,
    offset,
    src: `${CDN}/${card.path}.png`,
    srcset: offset === 0 ? `${CDN}/${card.path}.png 245w, ${CDN}/${card.path}_hires.png 734w` : null,
  }
})
</script>

<template>
  <div class="card-fan">
    <div
      v-for="card in cards"
      :key="card.path"
      class="fan-slot"
      :class="{ 'fan-slot-outer': Math.abs(card.offset) > 1 }"
      :style="{ '--i': card.offset, '--abs': Math.abs(card.offset) }"
    >
      <div class="fan-float">
        <HoloCard
          :src="card.src"
          :srcset="card.srcset"
          sizes="(max-width: 576px) 34vw, 230px"
          :alt="card.name"
          eager
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.card-fan {
  /* Parents can size the fan by setting --fan-card-w */
  --card-w: var(--fan-card-w, clamp(150px, 17vw, 230px));
  position: relative;
  width: 100%;
  height: calc(var(--card-w) * 88 / 63 * 1.2);
  display: grid;
  place-items: center;
}

.fan-slot {
  position: absolute;
  width: var(--card-w);
  z-index: calc(10 - var(--abs));
  transform: translateX(calc(var(--i) * var(--card-w) * 0.52)) translateY(calc(var(--abs) * 6%))
    rotate(calc(var(--i) * 7deg)) scale(calc(1 - var(--abs) * 0.06));
  transition:
    transform 0.5s var(--pb-ease-out),
    z-index 0s 0.1s;
  animation: fan-in 0.9s var(--pb-ease-out) both;
  animation-delay: calc(var(--abs) * 90ms + 150ms);
}

.fan-slot:hover {
  z-index: 20;
  transition:
    transform 0.5s var(--pb-ease-out),
    z-index 0s;
  transform: translateX(calc(var(--i) * var(--card-w) * 0.56)) translateY(calc(var(--abs) * 6% - 8%))
    rotate(calc(var(--i) * 4deg)) scale(1.04);
}

.fan-float {
  animation: fan-float 6s ease-in-out infinite;
  animation-delay: calc(var(--i) * -1.2s);
}

@keyframes fan-float {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-10px);
  }
}

@keyframes fan-in {
  from {
    opacity: 0;
    transform: translateY(40px) scale(0.9);
  }
}

@media (max-width: 575.98px) {
  .fan-slot-outer {
    display: none;
  }
}
</style>
