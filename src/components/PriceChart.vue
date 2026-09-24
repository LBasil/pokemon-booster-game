<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

// Line chart of a card's weekly Cardmarket price. One series, so no legend:
// the heading names it. Crosshair + tooltip follow the pointer; a visually
// hidden table carries the same data for screen readers.
const props = defineProps({
  points: { type: Array, required: true }, // [{ recorded_on: 'YYYY-MM-DD', value }]
})

const { t, locale } = useI18n()

const W = 320
const H = 130
const PAD = { top: 12, right: 56, bottom: 22, left: 8 }

const euros = (value) =>
  new Intl.NumberFormat(locale.value, { style: 'currency', currency: 'EUR', maximumFractionDigits: value < 10 ? 2 : 0 }).format(value)
const shortDate = (iso) => new Date(iso).toLocaleDateString(locale.value, { day: 'numeric', month: 'short' })

const data = computed(() => props.points.map((p) => ({ date: p.recorded_on, value: Number(p.value) })))

// Clean y range: 0 .. a round number above the max
const yMax = computed(() => {
  const max = Math.max(...data.value.map((d) => d.value), 0.01)
  const magnitude = 10 ** Math.floor(Math.log10(max))
  return Math.ceil((max * 1.1) / magnitude) * magnitude
})

const x = (i) => PAD.left + (data.value.length === 1 ? 0 : (i / (data.value.length - 1)) * (W - PAD.left - PAD.right))
const y = (value) => PAD.top + (1 - value / yMax.value) * (H - PAD.top - PAD.bottom)

const line = computed(() => data.value.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(' '))
const area = computed(() => {
  const last = data.value.length - 1
  return `${line.value} L${x(last).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`
})
const ticks = computed(() => [0, yMax.value / 2, yMax.value])

const change = computed(() => {
  const first = data.value[0]?.value
  const last = data.value.at(-1)?.value
  if (!first || data.value.length < 2) return null
  return ((last - first) / first) * 100
})

// Crosshair snaps to the nearest week
const svg = ref(null)
const hover = ref(null)
function onPointerMove(event) {
  const rect = svg.value.getBoundingClientRect()
  const px = ((event.clientX - rect.left) / rect.width) * W
  let best = 0
  data.value.forEach((_, i) => {
    if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i
  })
  hover.value = best
}
const hovered = computed(() => (hover.value === null ? null : { ...data.value[hover.value], i: hover.value }))
</script>

<template>
  <figure class="price-chart">
    <figcaption class="price-head">
      <span class="price-title">{{ t('collection.priceHistory') }}</span>
      <span v-if="change !== null" class="price-change">
        <span class="price-now">{{ euros(data.at(-1).value) }}</span>
        {{ change >= 0 ? '▲' : '▼' }} {{ new Intl.NumberFormat(locale, { maximumFractionDigits: 0, signDisplay: 'always' }).format(change) }} %
        <span class="pb-muted">{{ t('collection.since', { date: shortDate(data[0].date) }) }}</span>
      </span>
    </figcaption>

    <div class="price-plot">
      <svg
        ref="svg"
        :viewBox="`0 0 ${W} ${H}`"
        role="img"
        :aria-label="t('collection.priceSummary', { from: euros(data[0].value), to: euros(data.at(-1).value), weeks: data.length })"
        @pointermove="onPointerMove"
        @pointerleave="hover = null"
      >
        <g class="grid">
          <line v-for="tick in ticks" :key="tick" :x1="PAD.left" :x2="W - PAD.right" :y1="y(tick)" :y2="y(tick)" />
        </g>
        <g class="axis">
          <text v-for="tick in ticks.slice(1)" :key="tick" :x="W - PAD.right + 6" :y="y(tick) + 4">{{ euros(tick) }}</text>
          <text :x="PAD.left" :y="H - 6">{{ shortDate(data[0].date) }}</text>
          <text :x="W - PAD.right" :y="H - 6" text-anchor="end">{{ shortDate(data.at(-1).date) }}</text>
        </g>
        <path class="area" :d="area" />
        <path class="line" :d="line" />
        <template v-if="hovered">
          <line class="crosshair" :x1="x(hovered.i)" :x2="x(hovered.i)" :y1="PAD.top" :y2="H - PAD.bottom" />
          <circle class="dot" :cx="x(hovered.i)" :cy="y(hovered.value)" r="4.5" />
        </template>
        <circle v-else class="dot" :cx="x(data.length - 1)" :cy="y(data.at(-1).value)" r="4.5" />
      </svg>

      <div
        v-if="hovered"
        class="price-tooltip"
        :class="{ below: y(hovered.value) / H < 0.4 }"
        :style="{ left: `${(x(hovered.i) / W) * 100}%`, top: `${(y(hovered.value) / H) * 100}%` }"
        aria-hidden="true"
      >
        <strong>{{ euros(hovered.value) }}</strong>
        <span>{{ shortDate(hovered.date) }}</span>
      </div>
    </div>

    <table class="visually-hidden">
      <caption>{{ t('collection.priceHistory') }}</caption>
      <tr v-for="point in data" :key="point.date">
        <th scope="row">{{ shortDate(point.date) }}</th>
        <td>{{ euros(point.value) }}</td>
      </tr>
    </table>
  </figure>
</template>

<style scoped>
.price-chart {
  margin: 0;
}

.price-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.25rem 1rem;
  margin-bottom: 0.5rem;
}

.price-title {
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--pb-text-muted);
}

.price-change {
  font-size: 0.85rem;
  font-weight: 700;
}

.price-plot {
  position: relative;
}

svg {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
  touch-action: pan-y;
}

.grid line {
  stroke: var(--pb-grid);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.axis text {
  fill: var(--pb-text-muted);
  font-size: 10px;
  font-family: var(--pb-font-body);
  font-variant-numeric: tabular-nums;
}

.area {
  fill: var(--pb-series);
  opacity: 0.1;
}

.line {
  fill: none;
  stroke: var(--pb-series);
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}

.crosshair {
  stroke: var(--pb-text-muted);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.dot {
  fill: var(--pb-series);
  stroke: var(--pb-bg-elevated);
  stroke-width: 2;
}

.price-tooltip {
  position: absolute;
  transform: translate(-50%, calc(-100% - 12px));
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0.3rem 0.6rem;
  border-radius: var(--pb-radius-sm);
  background: var(--pb-text);
  color: var(--pb-bg);
  font-size: 0.75rem;
  white-space: nowrap;
  pointer-events: none;
}

/* Near the top of the plot the tooltip goes under the point, never over the heading */
.price-tooltip.below {
  transform: translate(-50%, 12px);
}

.price-now {
  margin-right: 0.4rem;
  font-family: var(--pb-font-display);
  font-size: 1rem;
}
</style>
