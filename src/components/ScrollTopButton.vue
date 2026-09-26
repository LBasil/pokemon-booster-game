<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

// "Back to top" for long pages (collection, binder, achievements, history):
// shows after about two screens of scrolling, above the phone tab bar.
const { t } = useI18n()
const visible = ref(false)

function onScroll() {
  visible.value = window.scrollY > window.innerHeight * 1.5
}

function toTop() {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
}

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
})
onBeforeUnmount(() => window.removeEventListener('scroll', onScroll))
</script>

<template>
  <Transition name="scroll-top">
    <button v-if="visible" type="button" class="scroll-top" :aria-label="t('common.backToTop')" :title="t('common.backToTop')" @click="toTop">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
    </button>
  </Transition>
</template>

<style scoped>
.scroll-top {
  position: fixed;
  right: 16px;
  /* Above the phone tab bar (see AppHeader's .app-tabbar) */
  bottom: calc(96px + env(safe-area-inset-bottom));
  z-index: 40;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1px solid var(--pb-border-strong);
  background: var(--pb-bg-elevated);
  color: var(--pb-text);
  box-shadow: var(--pb-shadow-lg);
}

.scroll-top svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

@media (hover: hover) {
  .scroll-top:hover {
    background: var(--pb-surface-hover);
  }
}

@media (min-width: 992px) {
  .scroll-top {
    right: 24px;
    bottom: 24px;
  }
}

.scroll-top-enter-active,
.scroll-top-leave-active {
  transition:
    opacity 0.2s,
    transform 0.2s;
}

.scroll-top-enter-from,
.scroll-top-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
