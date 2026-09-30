import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useElectrodeFlipStore } from '@/stores/electrodeFlip'
import { useEvolutionChainStore } from '@/stores/evolutionChain'
import { useMinigameStore } from '@/stores/minigame'
import { useSuperEffectiveStore } from '@/stores/superEffective'
import { GAMES } from '@/utils/games'

/**
 * The challenge mini-games with their status for today, for the games page
 * and the challenge hub. Each game plugs its store in `load` and `statusOf`
 * (`line`: what it still pays today; `record`: its best, '' if none yet).
 * Teasers (`soon`) have no store: always "Coming soon", not clickable.
 * @returns {{ games: import('vue').ComputedRef<object[]>, load: () => void }}
 */
export function useGames() {
  const { t } = useI18n()
  const higherLower = useMinigameStore()
  const electrodeFlip = useElectrodeFlipStore()
  const superEffective = useSuperEffectiveStore()
  const evolutionChain = useEvolutionChainStore()

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
    'super-effective': () => ({
      store: superEffective,
      inProgress: Boolean(superEffective.run),
      line: superEffective.paidLeft
        ? t('minigame.nextPaid', { count: superEffective.paidLeft }, superEffective.paidLeft)
        : t('minigame.nextFree'),
      record: superEffective.best ? t('minigame.bestShort', { count: superEffective.best }) : '',
    }),
    'evolution-chain': () => ({
      store: evolutionChain,
      inProgress: Boolean(evolutionChain.run),
      line: evolutionChain.paidLeft
        ? t('minigame.nextPaid', { count: evolutionChain.paidLeft }, evolutionChain.paidLeft)
        : t('minigame.nextFree'),
      record: evolutionChain.best ? t('minigame.bestShort', { count: evolutionChain.best }) : '',
    }),
  }

  const games = computed(() =>
    GAMES.map((game) => {
      const text = {
        title: t(`games.items.${game.id}.title`),
        desc: t(`games.items.${game.id}.desc`),
      }
      if (game.soon) return { ...game, ...text, available: false, loaded: true, inProgress: false, line: t('games.soon'), record: '' }
      const { store, ...status } = statusOf[game.id]()
      const available = !store.unavailable
      return {
        ...game,
        ...status,
        available,
        loaded: store.loaded,
        line: !available ? t('games.soon') : store.loaded ? status.line : '',
        record: available && store.loaded ? status.record : '',
        ...text,
      }
    }),
  )

  return {
    games,
    load: () => {
      higherLower.load()
      electrodeFlip.load()
      superEffective.load()
      evolutionChain.load()
    },
  }
}
