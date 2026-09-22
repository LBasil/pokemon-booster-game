<script setup>
defineProps({
  opening: { type: Boolean, default: false },
})
</script>

<template>
  <div class="booster-container">
    <div class="booster" :class="{ opening }">
      <div class="booster-front"></div>
      <div class="booster-back"></div>
    </div>
  </div>
</template>

<style scoped>
.booster-container {
  margin: 50px auto 0;
  position: relative;
  height: 350px;
  width: 200px;
  perspective: 1000px;
}

.booster {
  width: 200px;
  height: 350px;
  position: relative;
  transform-style: preserve-3d;
  animation: pulse 2s infinite;
}

.booster-front,
.booster-back {
  position: absolute;
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, #ffcb05 0%, #f08030 100%);
  border-radius: 12px;
  box-shadow: 0px 10px 30px rgba(0, 0, 0, 0.5);
  backface-visibility: hidden;
  display: flex;
  justify-content: center;
  align-items: center;
  font-size: 24px;
  font-weight: bold;
  color: white;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.booster-back {
  transform: rotateY(180deg);
}

@keyframes pulse {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.05);
  }
}

.booster.opening {
  animation:
    tear-open 1s forwards,
    reveal 1.5s 1s forwards;
}

@keyframes tear-open {
  0% {
    transform: scale(1) rotate(0deg);
  }
  100% {
    transform: scale(0.95) rotate(20deg);
  }
}

@keyframes reveal {
  0% {
    transform: rotate(20deg);
  }
  100% {
    transform: scale(1.2) rotateX(180deg);
  }
}
</style>
