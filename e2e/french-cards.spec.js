import { expect, test } from '@playwright/test'
import { byId } from './support/data.js'
import { mockSupabase, signIn } from './support/supabase.js'

// Cards in French (migration 0029): name and image from TCGdex when the site
// is in French and Profile > Settings > "Cards in French" is on; a card with
// no French print stays English, a French image that fails falls back.
test.beforeEach(async ({ page }) => {
  await signIn(page)
})

const entry = (id, extra) => ({ card_id: id, quantity: 1, acquired_at: '2026-09-20T10:00:00Z', cards: { ...byId[id], ...extra } })
const collection = [
  entry('base1-4', { name_fr: 'Dracaufeu', image_fr: 'https://assets.tcgdex.net/fr/base/base1/4' }),
  entry('sv3pt5-4', { name_fr: 'Salamèche', image_fr: 'https://assets.tcgdex.net/fr/missing/sv3pt5-4' }),
  entry('sv3pt5-7'),
]

test('French cards: names and images in French, English when there is none', async ({ page }) => {
  await mockSupabase(page, { collection })
  await page.goto('/collection')
  await expect(page.locator('.coll-card', { hasText: 'Charizard' })).toBeVisible()

  await page.getByRole('button', { name: 'FR', exact: true }).click()
  const charizard = page.locator('.coll-card', { hasText: 'Dracaufeu' })
  await expect(charizard).toBeVisible()
  await expect(charizard.locator('img')).toHaveAttribute('src', 'https://assets.tcgdex.net/fr/base/base1/4/low.webp')
  // No French image: back to the English one
  await expect(page.locator('.coll-card', { hasText: 'Salamèche' }).locator('img')).toHaveAttribute('src', byId['sv3pt5-4'].image_small)
  // Never printed in French: English
  await expect(page.locator('.coll-card', { hasText: 'Squirtle' })).toBeVisible()
  // The search finds the French card name
  await page.getByRole('searchbox', { name: 'Rechercher dans tes cartes' }).fill('dracau')
  await expect(page.locator('.coll-card')).toHaveCount(1)
  await page.locator('.coll-card').click()
  await expect(page.locator('.detail-name')).toHaveText('Dracaufeu')
  await expect(page.locator('.detail-fr-name')).toHaveText('En anglais : Charizard')
  await page.keyboard.press('Escape')

  // Profile > Settings: cards in English while the site stays in French
  await page.goto('/profile')
  await page.getByRole('switch', { name: /Cartes en français/ }).uncheck()
  await page.goto('/collection')
  await expect(page.locator('.coll-card', { hasText: 'Charizard' })).toBeVisible()
  await expect(page.locator('.coll-card', { hasText: 'Dracaufeu' })).toHaveCount(0)
})
