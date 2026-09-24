import { expect, test } from '@playwright/test'
import { mockSupabase, signIn } from './support/supabase.js'

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

// Taps the pile until the summary shows (hits ignore taps while they charge up)
async function revealAll(page) {
  const stack = page.locator('.card-stack')
  await expect(stack).toBeVisible()
  for (let i = 0; i < 30 && !(await page.locator('.done-layout').isVisible()); i++) {
    if (await stack.isVisible()) await stack.click({ force: true })
    await page.waitForTimeout(150)
  }
}

test('opening a booster: tear, reveal, summary — saved by the server in one call', async ({ page }) => {
  const backend = await mockSupabase(page)
  await page.goto('/boosters')
  await page.getByRole('button', { name: /Open 1 booster/ }).click()

  const pack = page.locator('.booster-pack')
  await expect(pack).toBeEnabled()
  await pack.click({ force: true })
  await revealAll(page)

  await expect(page.getByRole('heading', { level: 1 })).toContainText('10')
  await expect(page.getByText('Best pull')).toBeVisible()
  expect(backend.calls.filter((c) => c.path === '/rest/v1/rpc/open_my_booster')).toHaveLength(1)
  // The client never writes collection rows itself
  expect(backend.calls.some((c) => c.path === '/rest/v1/collections' && c.method !== 'GET' && c.method !== 'HEAD')).toBe(false)
})

test('"open all at once" skips the animations for every remaining pack', async ({ page }) => {
  const backend = await mockSupabase(page)
  await page.goto('/boosters')
  await page.getByRole('radio', { name: '3', exact: true }).click()
  await page.getByRole('button', { name: /Open 3 boosters/ }).click()
  await page.getByRole('button', { name: /Open all 3 at once/ }).click()

  await expect(page.locator('.done-layout')).toBeVisible()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('30')
  expect(backend.calls.filter((c) => c.path === '/rest/v1/rpc/open_my_booster')).toHaveLength(3)
})

test('a wishlisted card gets the "Wanted!" badge when pulled', async ({ page }) => {
  const backend = await mockSupabase(page)
  backend.state.wishlist.push({ card_id: 'sv3pt5-199', created_at: '2026-09-20T10:00:00Z', cards: { id: 'sv3pt5-199', name: 'Charizard ex' } })
  await page.goto('/boosters')
  await page.getByRole('button', { name: /Open 1 booster/ }).click()
  const pack = page.locator('.booster-pack')
  await expect(pack).toBeEnabled() // disabled while the server draws the pack
  await pack.click({ force: true })
  await revealAll(page)
  await expect(page.locator('.done-grid .wanted-chip')).toHaveCount(1)
})
