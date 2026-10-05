import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/settings'
import { cardImageIn, cardNameIn, cardSrcsetIn, englishImage } from '@/utils/cardLocale'

/**
 * Card names and images in the player's language (migration 0029): French
 * cards when the site is in French and Profile > Settings > "Cards in
 * French" is on. Put `:data-fallback="fallback(card)"` on the <img>: if the
 * French image fails, main.js swaps in the English one.
 */
export function useCardLocale() {
  const { locale } = useI18n()
  const settings = useSettingsStore()
  const french = computed(() => locale.value.startsWith('fr') && settings.frenchCards)
  return {
    french,
    cardName: (card) => cardNameIn(card, french.value),
    cardImage: (card, size = 'small') => cardImageIn(card, french.value, size),
    cardSrcset: (card) => cardSrcsetIn(card, french.value),
    fallback: (card, size = 'small') => englishImage(card, size),
  }
}
