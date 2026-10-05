import { tcgdexImage } from './tcgdex'

// Which name and image of a card to show (migration 0029: cards.name_fr /
// image_fr from TCGdex). `french` = the site is in French and the player
// kept "Cards in French" on (useCardLocale). A card with no French print
// (Base Set 2, Gym Heroes...) or loaded by an RPC that doesn't return the
// French columns shows in English.

/** @param {{ name?: string, name_fr?: string | null } | null | undefined} card */
export const cardNameIn = (card, french) => (french && card?.name_fr) || card?.name || ''

/** The English image, the fallback of a French one that fails to load. */
export const englishImage = (card, size = 'small') =>
  (size === 'large' ? card?.image_url || card?.image_small : card?.image_small || card?.image_url) || null

/**
 * @param {{ image_small?: string, image_url?: string, image_fr?: string | null } | null | undefined} card
 * @param {'small' | 'large'} size
 */
export const cardImageIn = (card, french, size = 'small') => (french && tcgdexImage(card?.image_fr, size)) || englishImage(card, size)

/** A srcset with both sizes, or null when only one is known. */
export function cardSrcsetIn(card, french) {
  if (french && card?.image_fr) return `${tcgdexImage(card.image_fr, 'small')} 245w, ${tcgdexImage(card.image_fr, 'large')} 600w`
  return card?.image_small && card?.image_url ? `${card.image_small} 245w, ${card.image_url} 734w` : null
}
