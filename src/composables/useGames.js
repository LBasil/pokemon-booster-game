import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMinigameStore } from '@/stores/minigame'
import { GAMES } from '@/utils/games'

/**
 * The challenge mini-games with their status for today, for the games page
 * and the challenge hub. Each game plugs its store in `load` and `statusOf`.
 * @returns {{ games: import('vue').ComputedRef<object[]>, load: () => void, paidLeft: import('vue').ComputedRef<number> }}
 */
export function useGames() {
  const { t } = useI18n()
  const higherLower = useMinigameStore()

  const statusOf = {
    'higher-lower': () => ({
      available: !higherLower.unavailable,
      loaded: higherLower.loaded,
      paidLeft: higherLower.paidLeft,
      best: higherLower.best,
      inProgress: Boolean(higherLower.run),
    }),
  }

  const games = computed(() =>
    GAMES.map((game) => {
      const status = statusOf[game.id]()
      let line = ''
      if (!status.available) line = t('games.soon')
      else if (status.loaded) {
        line = status.paidLeft ? t('minigame.nextPaid', { count: status.paidLeft }, status.paidLeft) : t('minigame.nextFree')
      }
      return {
        ...game,
        ...status,
        line,
        title: t(`games.items.${game.id}.title`),
        desc: t(`games.items.${game.id}.desc`),
      }
    }),
  )

  return {
    games,
    load: () => higherLower.load(),
    // Paid runs left across every game (the hub shows it)
    paidLeft: computed(() => games.value.reduce((sum, game) => sum + (game.available ? game.paidLeft : 0), 0)),
  }
}
