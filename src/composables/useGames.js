import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useElectrodeFlipStore } from '@/stores/electrodeFlip'
import { useMinigameStore } from '@/stores/minigame'
import { GAMES } from '@/utils/games'

/**
 * The challenge mini-games with their status for today, for the games page
 * and the challenge hub. Each game plugs its store in `load` and `statusOf`
 * (`line`: what it still pays today; `record`: its best, '' if none yet).
 * @returns {{ games: import('vue').ComputedRef<object[]>, load: () => void }}
 */
export function useGames() {
  const { t } = useI18n()
  const higherLower = useMinigameStore()
  const electrodeFlip = useElectrodeFlipStore()

  const statusOf = {
    'higher-lower': () => ({
      store: higherLower,
      inProgress: Boolean(higherLower.run),
      line: higherLower.paidLeft
        ? t('minigame.nextPaid', { count: higherLower.paidLeft }, higherLower.paidLeft)
        : t('minigame.nextFree'),
      record: higherLower.best ? t('minigame.bestShort', { count: higherLower.best }) : '',
    }),
    'electrode-flip': () => ({
      store: electrodeFlip,
      inProgress: Boolean(electrodeFlip.board),
      line: electrodeFlip.coinsLeft
        ? t('electrodeFlip.coinsLeftLine', { count: electrodeFlip.coinsLeft })
        : t('electrodeFlip.nextFree'),
      record: t('electrodeFlip.levelShort', { level: electrodeFlip.level }),
    }),
  }

  const games = computed(() =>
    GAMES.map((game) => {
      const { store, ...status } = statusOf[game.id]()
      const available = !store.unavailable
      return {
        ...game,
        ...status,
        available,
        loaded: store.loaded,
        line: !available ? t('games.soon') : store.loaded ? status.line : '',
        record: available && store.loaded ? status.record : '',
        title: t(`games.items.${game.id}.title`),
        desc: t(`games.items.${game.id}.desc`),
      }
    }),
  )

  return {
    games,
    load: () => {
      higherLower.load()
      electrodeFlip.load()
    },
  }
}
