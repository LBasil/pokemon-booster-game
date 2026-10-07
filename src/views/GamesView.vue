<script setup>
import { onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useGames } from '@/composables/useGames'
import { useChallengeStore } from '@/stores/challenge'
import AppHeader from '@/components/AppHeader.vue'
import AlphaTag from '@/components/AlphaTag.vue'

// The challenge's mini-games: every game in src/utils/games.js, with what
// it still pays today. Each one opens its own page.
const { t } = useI18n()
const challenge = useChallengeStore()
const { games, load } = useGames()

onMounted(() => {
  challenge.load() // the header's coins
  load()
})
</script>

<template>
  <div class="pb-page">
    <AppHeader />

    <main class="container games">
      <header class="games-head">
        <h1 class="games-title">{{ t('games.title') }}</h1>
        <p class="games-subtitle">{{ t('games.subtitle') }}</p>
      </header>

      <ul class="games-grid" role="list">
        <li v-for="game in games" :key="game.id">
          <component
            :is="game.soon ? 'div' : RouterLink"
            :to="game.soon ? undefined : { name: game.route }"
            class="game-tile"
            :class="{ off: !game.available, soon: game.soon }"
          >
            <span class="game-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path :d="game.icon" /></svg>
            </span>
            <span class="game-text">
              <span class="game-title">{{ game.title }} <AlphaTag v-if="game.alpha && game.available" /></span>
              <span class="game-desc">{{ game.desc }}</span>
              <span v-if="game.line" class="game-status">
                {{ game.line }}
                <template v-if="game.record"> · {{ game.record }}</template>
              </span>
            </span>
            <span v-if="game.available" class="game-cta">{{ game.inProgress ? t('minigame.resume') : t('minigame.play') }}</span>
          </component>
        </li>
        <li class="game-more">
          <span>{{ t('games.more') }}</span>
        </li>
      </ul>

      <RouterLink :to="{ name: 'challenge' }" class="games-back"><span aria-hidden="true">←</span> {{ t('challenge.backToHub') }}</RouterLink>
    </main>
  </div>
</template>

<style scoped>
.games {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  padding-top: 1rem;
}

.games-head {
  animation: pb-rise 0.6s var(--pb-ease-out) both;
}

.games-title {
  margin: 0 0 0.5rem;
  font-size: clamp(1.8rem, 5vw, 2.8rem);
  font-weight: 800;
}

.games-subtitle {
  max-width: 40rem;
  margin: 0;
  color: var(--pb-text-muted);
}

.games-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.games-grid > li {
  min-width: 0;
}

.game-tile {
  display: flex;
  align-items: center;
  gap: 1rem;
  height: 100%;
  padding: 1.25rem;
  border-radius: var(--pb-radius-lg);
  border: 1px solid var(--pb-border);
  background: var(--pb-surface);
  box-shadow: var(--pb-shadow-card);
  color: var(--pb-text);
  text-decoration: none;
  transition:
    transform 0.2s var(--pb-ease-out),
    border-color 0.2s;
}

@media (hover: hover) {
  .game-tile:not(.soon):hover {
    transform: translateY(-3px);
    border-color: var(--pb-ring);
  }
}

.game-tile.off {
  opacity: 0.7;
}

/* A teaser: not playable yet */
.game-tile.soon {
  border-style: dashed;
  box-shadow: none;
}

.game-icon {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 3.25rem;
  height: 3.25rem;
  border-radius: var(--pb-radius-md);
  background: var(--pb-holo);
}

.game-icon svg {
  width: 1.75rem;
  height: 1.75rem;
  fill: none;
  stroke: var(--pb-accent-ink);
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.game-text {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}

.game-title {
  font-family: var(--pb-font-display);
  font-size: 1.1rem;
  font-weight: 700;
}

.game-desc {
  color: var(--pb-text-muted);
}

.game-status {
  font-size: 0.9rem;
  font-weight: 700;
}

.game-cta {
  flex: 0 0 auto;
  padding: 0.45rem 1rem;
  border-radius: 999px;
  background: var(--pb-accent);
  color: var(--pb-accent-ink);
  font-weight: 700;
}

.game-more {
  display: grid;
  place-items: center;
  min-height: 5rem;
  padding: 1.25rem;
  border-radius: var(--pb-radius-lg);
  border: 1px dashed var(--pb-border-strong);
  color: var(--pb-text-muted);
  text-align: center;
}

.games-back {
  align-self: flex-start;
  font-weight: 700;
}

/* Phones: the button moves under the text */
@media (max-width: 575.98px) {
  .game-tile {
    flex-wrap: wrap;
  }

  .game-text {
    flex-basis: calc(100% - 4.25rem);
  }

  .game-cta {
    margin-left: 4.25rem;
  }
}

@media (min-width: 768px) {
  .games-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
