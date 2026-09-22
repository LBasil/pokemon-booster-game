<script setup>
defineProps({
  cards: { type: Array, required: true },
  revealedCount: { type: Number, required: true },
})

defineEmits(['tap'])
</script>

<template>
  <div class="card-stack" @click="$emit('tap')">
    <div
      v-for="(card, index) in cards"
      :key="card.id"
      class="card"
      :class="{
        hidden: index >= revealedCount,
        revealed: index === revealedCount - 1,
        removed: index < revealedCount - 1,
      }"
    >
      <img :src="card.image_url" :alt="card.name" class="card-img" />
    </div>
  </div>
</template>

<style scoped>
.card-stack {
  display: flex;
  justify-content: center;
  position: relative;
  height: 350px;
  margin: -350px auto 0;
  cursor: pointer;
}

.card {
  position: absolute;
  width: 250px;
  height: 350px;
  background-color: white;
  border-radius: 8px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
  opacity: 0;
  transition:
    transform 0.5s ease,
    opacity 0.5s ease;
  z-index: 100;
}

.card-img {
  width: 100%;
  height: 100%;
  border-radius: 8px;
  object-fit: cover;
}

.card.revealed {
  opacity: 1;
  transform: translateY(0);
}

.card.hidden {
  opacity: 0;
  transform: translateY(-50px);
}

.card.removed {
  transform: translateY(-200px);
  opacity: 0;
  transition:
    transform 0.5s ease-in,
    opacity 0.5s ease-in;
}
</style>
