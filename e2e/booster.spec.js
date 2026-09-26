import { expect, test } from '@playwright/test'
import { SETS, collectionEntry } from './support/data.js'
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

test('a subset is opened through its parent set, which says so', async ({ page }) => {
  const classic = { id: 'sv3pt5c', name: '151 Classic', release_date: '2023-09-22', total: 30, parent_set_id: 'sv3pt5', subset_rate: 0.33 }
  await mockSupabase(page, { sets: [...SETS, classic] })
  await page.goto('/boosters?set=sv3pt5c') // e.g. from the subset's binder
  await expect(page.locator('.preview-name')).toHaveText('151')
  await expect(page.locator('.preview-subset')).toHaveText('Also holds the 151 Classic: about 1 pack in 3 has one of its cards.')
  await expect(page.locator('.set-option-name', { hasText: '151 Classic' })).toHaveCount(0)
  await expect(page.locator('.set-option', { hasText: '151' }).first()).toContainText('+30 bonus cards')
})

test('the history shows the exact number of boosters opened', async ({ page }) => {
  // 50 unlimited cards = 5 packs, 2 of them logged by the server
  const stats = { packs: 2, hit_packs: 1, today: 2, best_day: 2, best_streak: 1, top_set_id: 'sv3pt5', top_set_packs: 2, first_at: '2026-09-25T10:00:00Z' }
  await mockSupabase(page, { collection: [collectionEntry('sv3pt5-4', 50)], stats: { unlimited: stats } })
  await page.goto('/history')
  await expect(page.locator('.total-main dd')).toHaveText('5')
  await expect(page.locator('.history-totals')).toContainText('50 %')
  await expect(page.locator('.totals-note')).toContainText('3 older boosters')
})

test('the last opened set is preselected next time, per mode', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/boosters')
  await page.evaluate(() => localStorage.setItem('pb-last-set:unlimited', 'base1'))
  await page.reload()
  await expect(page.locator('.preview-name')).toHaveText('Base')
  await page.goto('/challenge/boosters')
  await expect(page.locator('.preview-name')).toHaveText('Any set') // the challenge remembers its own
})

test('on a new device, the last pack logged by the server gives the preselection', async ({ page }) => {
  const backend = await mockSupabase(page)
  backend.state.openings.push({ id: 1, mode: 'unlimited', set_id: 'base1', card_ids: [], best_card_id: null, hits: 0, secrets: 0, god_pack: false, opened_at: '2026-09-25T10:00:00Z' })
  await page.goto('/boosters')
  await expect(page.locator('.preview-name')).toHaveText('Base')
})

test('the history can show only the boosters with a hit', async ({ page }) => {
  const backend = await mockSupabase(page)
  const opening = (id, hits) => ({ id, mode: 'unlimited', set_id: 'sv3pt5', card_ids: [], best_card_id: null, hits, secrets: 0, god_pack: false, opened_at: `2026-09-25T1${id}:00:00Z` })
  backend.state.openings.push(opening(1, 0), opening(2, 1), opening(3, 0))
  await page.goto('/history')
  await expect(page.locator('.history-item')).toHaveCount(3)
  await page.getByRole('button', { name: 'With a hit' }).click()
  await expect(page.locator('.history-item')).toHaveCount(1)
  await page.getByRole('button', { name: 'All', exact: true }).click()
  await expect(page.locator('.history-item')).toHaveCount(3)
})
