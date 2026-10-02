import { expect, test } from '@playwright/test'
import { SETS, collectionEntry } from './support/data.js'
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

  await page.getByRole('button', { name: /Mewtwo \(missing\)/ }).click()
  await page.getByRole('button', { name: 'Add to wishlist' }).click()
  await expect(page.getByRole('button', { name: 'Remove from wishlist' })).toBeVisible()
  expect(backend.calls.some((c) => c.path === '/rest/v1/wishlist' && c.method === 'POST')).toBe(true)
})

test('a long set name never pushes the "Complete" badge off screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  const sets = SETS.map((set) => (set.id === 'base1' ? { ...set, name: "McDonald's Collection 2021 Anniversary Celebration Edition" } : set))
  await mockSupabase(page, { sets, collection: [collectionEntry('base1-4'), collectionEntry('base1-58')] })
  await page.goto('/collection?view=sets')

  const badge = page.locator('.coll-set-complete')
  await expect(badge).toBeVisible()
  const box = await badge.boundingBox()
  const tile = await page.locator('.coll-set.complete').boundingBox()
  expect(box.x + box.width).toBeLessThanOrEqual(tile.x + tile.width)
})

test('the search also knows the French names, and a card detail says it in French', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/collection')
  await page.getByRole('searchbox', { name: 'Search your cards' }).fill('Dracaufeu')
  await expect(page.locator('.coll-count')).toContainText('1 card')
  await expect(page.locator('.coll-card')).toContainText('Charizard')

  await page.getByRole('button', { name: 'FR', exact: true }).click()
  await page.locator('.coll-card', { hasText: 'Charizard' }).click()
  await expect(page.locator('.detail-fr-name')).toHaveText('En français : Dracaufeu')
})

test('the collection shows the most advanced set as a goal within reach', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/collection')
  // Base: 1 card of 2, ahead of 151 (1 of 11)
  const goal = page.locator('.set-goal')
  await expect(goal).toContainText('Most advanced set:')
  await expect(goal).toContainText('Base')
  await expect(goal).toContainText('1 / 2 (50%)')
  await goal.getByRole('link', { name: 'Base' }).click()
  await expect(page).toHaveURL('/collection/set/base1')

  await page.goto('/game')
  await expect(page.locator('.hub-collection .set-goal')).toContainText('Base')
})
