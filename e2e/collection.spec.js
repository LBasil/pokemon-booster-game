import { expect, test } from '@playwright/test'
import { mockSupabase, signIn } from './support/supabase.js'

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

test('filters live in the URL', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/collection')
  await expect(page.locator('.coll-count')).toContainText('2 cards')
  await page.getByRole('button', { name: 'Rares & holos' }).click()
  await expect(page).toHaveURL(/rarity=rare/)
  await expect(page.locator('.coll-count')).toContainText('1 card')
})

test('Pokédex shows caught species out of the pool', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/collection?view=pokedex')
  await expect(page.locator('.dex-count')).toContainText('2 / 151')
  await page.getByRole('button', { name: /Charizard: show your card/ }).click()
  await expect(page).toHaveURL(/dex=6/)
})

test('binder shows missing slots, and a missing card can be wishlisted', async ({ page }) => {
  const backend = await mockSupabase(page)
  await page.goto('/collection?view=sets')
  await page.locator('.coll-set', { hasText: '151' }).click()
  await expect(page).toHaveURL('/collection/set/sv3pt5')
  await expect(page.locator('.binder-meta')).toContainText('1 / 11 cards')

  await page.getByRole('button', { name: /Mewtwo — missing/ }).click()
  await page.getByRole('button', { name: 'Add to wishlist' }).click()
  await expect(page.getByRole('button', { name: 'Remove from wishlist' })).toBeVisible()
  expect(backend.calls.some((c) => c.path === '/rest/v1/wishlist' && c.method === 'POST')).toBe(true)
})
