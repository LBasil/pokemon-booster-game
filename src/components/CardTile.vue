<script setup>
defineProps({
  card: { type: Object, required: true },
  quantity: { type: Number, default: null },
})
</script>

<template>
  <div class="card-tile">
    <img :src="card.image_small || card.image_url" :alt="card.name" loading="lazy" />
    <span v-if="quantity" class="quantity-badge">x{{ quantity }}</span>
    <div class="card-tile-name">{{ card.name }}</div>
  </div>
</template>

<style scoped>
.card-tile {
  position: relative;
  width: 140px;
}

.card-tile img {
  width: 100%;
  border-radius: 8px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
}

.quantity-badge {
  position: absolute;
  top: 6px;
  right: 6px;
  background: rgba(0, 0, 0, 0.75);
  color: #fff;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 0.8rem;
  font-weight: bold;
}

.card-tile-name {
  margin-top: 4px;
  font-size: 0.85rem;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
