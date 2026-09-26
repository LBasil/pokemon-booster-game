import { expect, test } from '@playwright/test'
import { mockSupabase, signIn } from './support/supabase.js'

// "Higher or lower" (migration 0013). The mock serves MINIGAME_PAIRS in
// order: the pricier card is on the right, then left, left, right.
test.beforeEach(async ({ page }) => {
  await signIn(page)
})

const card = (page, side) => page.locator(`.mg-card[data-side="${side}"]`)

test('the challenge hub leads to the mini-game, which pays right answers until a wrong one', async ({ page }) => {
  const backend = await mockSupabase(page)
  await page.goto('/challenge')
  const tile = page.locator('.ch-minigame')
  await expect(tile).toContainText('Higher or lower')
  await expect(tile).toContainText('3 paid runs left today')
  await tile.getByRole('link', { name: 'Play' }).click()
  await expect(page).toHaveURL(/\/challenge\/minigame$/)
  await expect(page.locator('.mode-strip')).toBeVisible() // still in the challenge

  await page.getByRole('button', { name: 'Play' }).click()
  await expect(page.getByRole('heading', { name: 'Which card is worth more?' })).toBeVisible()
  await expect(page.locator('.mg-chip')).toHaveText('Paid run')
  await expect(page.locator('.mg-price')).toHaveCount(0) // no price before answering

  // Right: Charizard (€300) beats Mewtwo (€2)
  await card(page, 'right').click()
  await expect(page.locator('.mg-feedback')).toContainText('Right!')
  await expect(page.locator('.mg-feedback')).toContainText('+5')
  await expect(card(page, 'right')).toHaveClass(/is-pricier/)
  await expect(card(page, 'right').locator('.mg-price')).toHaveText('€300')
  await expect(page.locator('.mode-strip')).toContainText('1,005')

  // The next pair comes by itself; this time the left one is pricier
  await expect(page.locator('.mg-price')).toHaveCount(0)
  await expect(page.locator('.mg-streak')).toHaveText('Streak: 1')
  await card(page, 'right').click()
  await expect(page.locator('.mg-feedback')).toContainText('Wrong!')
  await expect(card(page, 'right')).toHaveClass(/is-wrong/)
  await expect(card(page, 'left')).toHaveClass(/is-pricier/)
  // Both prices show on the second pair too (a Vue list-key bug once hid them)
  await expect(card(page, 'left').locator('.mg-price')).toHaveText('€12')
  await expect(card(page, 'right').locator('.mg-price')).toHaveText('€0.20')
  await expect(card(page, 'left')).toContainText('Charizard ex')

  const over = page.locator('.mg-over')
  await expect(over).toContainText('Run over')
  await expect(over).toContainText('1 right answer')
  await expect(over).toContainText('New record!')
  await expect(over).toContainText('+5')
  await expect(page.getByText('2 paid runs left today')).toBeVisible()
  expect(backend.calls.filter((c) => c.path === '/rest/v1/rpc/minigame_answer')).toHaveLength(2)

  await page.getByRole('button', { name: 'Play again' }).click()
  await expect(over).toBeHidden()
  await expect(page.locator('.mg-streak')).toHaveText('Streak: 0')
})

test('the arrow keys answer too', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/challenge/minigame')
  await page.getByRole('button', { name: 'Play' }).click()
  await expect(card(page, 'left')).toBeEnabled()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.mg-feedback')).toContainText('Right!')
})

test('once the paid runs are used, the game goes on for the record only', async ({ page }) => {
  await mockSupabase(page, { minigame: { paidUsed: 3, best: 7 } })
  await page.goto('/challenge/minigame')
  await expect(page.getByText('No more coins today: play for the record.')).toBeVisible()
  await expect(page.locator('.mg-stats')).toContainText('0 / 3')
  await expect(page.locator('.mg-stats')).toContainText('7')
  await page.getByRole('button', { name: 'Play' }).click()
  await expect(page.locator('.mg-chip')).toHaveText('For the record')
  await card(page, 'right').click()
  await expect(page.locator('.mg-feedback')).toContainText('Right!')
  await expect(page.locator('.mg-feedback .coin-amount')).toHaveCount(0)
})

test('the run ends when time runs out', async ({ page }) => {
  await page.clock.install()
  const backend = await mockSupabase(page)
  await page.goto('/challenge/minigame')
  await page.getByRole('button', { name: 'Play' }).click()
  await expect(card(page, 'left')).toBeEnabled()
  await page.clock.fastForward('00:16')
  await expect(page.locator('.mg-over')).toContainText('Too slow!')
  const answer = backend.calls.find((c) => c.path === '/rest/v1/rpc/minigame_answer')
  expect(JSON.parse(answer.body)).toEqual({ p_pick: null })
})

test('a run in progress is resumed after a reload', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/challenge/minigame')
  await page.getByRole('button', { name: 'Play' }).click()
  await expect(card(page, 'left')).toContainText('Mewtwo')
  await page.goto('/challenge')
  await expect(page.locator('.ch-minigame').getByRole('link', { name: 'Resume the run' })).toBeVisible()
  await page.goto('/challenge/minigame')
  await expect(card(page, 'left')).toContainText('Mewtwo')
  await expect(page.getByRole('button', { name: 'Play' })).toHaveCount(0)
})

test('before migration 0013 the hub simply has no mini-game', async ({ page }) => {
  await mockSupabase(page, { minigame: 'missing' })
  await page.goto('/challenge')
  await expect(page.locator('.ch-wallet')).toBeVisible()
  await expect(page.locator('.ch-minigame')).toHaveCount(0)
  await page.goto('/challenge/minigame')
  await expect(page.getByText('The mini-game is coming soon.')).toBeVisible()
})
