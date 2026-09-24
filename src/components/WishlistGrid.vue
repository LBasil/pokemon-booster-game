<script setup>
import { useI18n } from 'vue-i18n'
import { useWishlistStore } from '@/stores/wishlist'
import { cardNumber } from '@/utils/collection'

// The cards a player is hunting. Clicking one opens it (via `open`); the
// heart removes it. Cards leave the list on their own when pulled.
defineEmits(['open'])

const { t } = useI18n()
const wishlist = useWishlistStore()
</script>

<template>
  <section class="wish">
    <p class="pb-muted wish-intro">{{ t('wishlist.intro') }}</p>

    <div v-if="wishlist.loading && !wishlist.loaded" class="wish-grid">
      <div v-for="n in 6" :key="n" class="pb-skeleton" style="aspect-ratio: 63 / 88"></div>
    </div>

    <div v-else-if="!wishlist.entries.length" class="wish-empty">
      <p>{{ t('wishlist.empty') }}</p>
      <RouterLink :to="{ name: 'collection', query: { view: 'sets' } }" class="btn btn-outline-secondary">
        {{ t('wishlist.browseSets') }}
      </RouterLink>
    </div>

    <ul v-else class="wish-grid" role="list">
      <li v-for="(entry, index) in wishlist.entries" :key="entry.card_id" class="wish-item">
        <button type="button" class="wish-card" :aria-label="entry.cards.name" @click="$emit('open', index)">
          <img :src="entry.cards.image_small || entry.cards.image_url" alt="" loading="lazy" />
        </button>
        <div class="wish-row">
          <span class="wish-name">{{ entry.cards.name }}</span>
          <button
            type="button"
            class="wish-remove"
            :aria-label="t('wishlist.remove', { name: entry.cards.name })"
            :title="t('wishlist.remove', { name: entry.cards.name })"
            @click="wishlist.toggle(entry.cards)"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" /></svg>
          </button>
        </div>
        <span class="wish-meta">{{ entry.cards.set_id }} · {{ cardNumber(entry.card_id) }}</span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.wish {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.wish-intro {
  margin: 0;
}

.wish-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 1.25rem 0.9rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.wish-item {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
}

.wish-card {
  padding: 0;
  border: none;
  background: none;
  border-radius: 6px;
}

.wish-card img {
  display: block;
  width: 100%;
  aspect-ratio: 63 / 88;
  object-fit: cover;
  border-radius: 4.5% / 3.2%;
  box-shadow: var(--pb-shadow-card);
}

.wish-row {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.wish-name {
  flex: 1;
  min-width: 0;
  font-size: 0.85rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wish-remove {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  border: none;
  background: none;
  color: var(--pb-ring);
}

.wish-remove svg {
  width: 18px;
  height: 18px;
  fill: currentColor;
}

.wish-meta {
  font-size: 0.72rem;
  color: var(--pb-text-muted);
}

.wish-empty {
  padding: 2rem;
  border-radius: var(--pb-radius-lg);
  border: 1px dashed var(--pb-border-strong);
  text-align: center;
  color: var(--pb-text-muted);
}
</style>
