import { expect, test } from '@playwright/test'
import { mockSupabase, signIn } from './support/supabase.js'

// "Shiny Electrode Flip" (migration 0014). The mock always deals
// ELECTRODE_BOARD: 2s on tiles 2 and 18, a 3 on tile 5, Electrodes on 3, 9,
// 11 and 20.
test.beforeEach(async ({ page }) => {
  await signIn(page)
})

const tile = (page, index) => page.locator(`.ef-tile[data-index="${index}"]`)
const flip = async (page, index) => {
  await expect(tile(page, index)).toBeEnabled()
  await tile(page, index).click()
  await expect(tile(page, index)).toHaveClass(/is-up/)
}

test('the game is listed with the others and opens from its tile', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/challenge')
  await expect(page.locator('.ch-games')).toContainText('Shiny Electrode Flip')
  await page.goto('/challenge/games')
  const card = page.locator('.game-tile').filter({ hasText: 'Shiny Electrode Flip' })
  await expect(card).toContainText('300 coins left to win today')
  await expect(card).toContainText('level 1')
  await card.click()
  await expect(page).toHaveURL(/\/challenge\/games\/electrode-flip$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Shiny Electrode Flip' })).toBeVisible()
  await expect(page.locator('.mode-strip')).toBeVisible()
})

test('clearing a board pays its points and moves up a level', async ({ page }) => {
  const backend = await mockSupabase(page)
  await page.goto('/challenge/games/electrode-flip')
  await page.getByRole('button', { name: 'Deal a level 1 board' }).click()

  // Hints: row 1 = 1+1+2+1 = 5 points, 1 Electrode; column 1 = 1+3+1+1 = 6, 1 Electrode
  await expect(page.locator('.ef-hint[data-row="0"] strong')).toHaveText('5')
  await expect(page.locator('.ef-hint[data-row="0"] .ef-hint-e')).toHaveText('1')
  await expect(page.locator('.ef-hint[data-col="0"] strong')).toHaveText('6')
  await expect(page.locator('.ef-tile.is-up')).toHaveCount(0) // nothing given away

  const cash = page.getByRole('button', { name: /Cash out/ })
  await expect(cash).toBeDisabled() // nothing to keep yet
  await flip(page, 2)
  await expect(tile(page, 2)).toHaveAttribute('aria-label', 'Row 1, column 3: 2')
  await flip(page, 5)
  await expect(page.locator('.ef-points strong')).toHaveText('6')
  await expect(cash).toHaveText('Cash out 6 points')
  await flip(page, 18)

  const over = page.locator('.ef-over')
  await expect(over).toContainText('Board cleared!')
  await expect(over).toContainText('12 points')
  await expect(over).toContainText('+12')
  await expect(over).toContainText('New record!')
  await expect(over).toContainText('Next board: level 2')
  await expect(page.locator('.mode-strip')).toContainText('1,012')
  // The whole board shows, the tiles never flipped dimmed
  await expect(page.locator('.ef-tile.is-up')).toHaveCount(25)
  await expect(tile(page, 3)).toHaveClass(/is-missed/)
  await expect(page.locator('.ef-stats')).toContainText('2 / 5')
  expect(backend.calls.filter((c) => c.path === '/rest/v1/rpc/electrode_flip_flip').map((c) => JSON.parse(c.body).p_index)).toEqual([2, 5, 18])

  await page.getByRole('button', { name: 'Next board (level 2)' }).click()
  await expect(over).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Level 2' })).toBeVisible()
})

test('an Electrode loses the board and drops the level', async ({ page }) => {
  await mockSupabase(page, { electrodeFlip: { level: 3 } })
  await page.goto('/challenge/games/electrode-flip')
  await page.getByRole('button', { name: 'Deal a level 3 board' }).click()
  await flip(page, 0)
  await flip(page, 3)
  await expect(tile(page, 3)).toHaveClass(/is-electrode/)
  const over = page.locator('.ef-over')
  await expect(over).toContainText('Boom!')
  await expect(over).not.toContainText('points')
  await expect(over.locator('.coin-amount')).toHaveCount(0)
  await expect(over).toContainText('Next board: back to level 1')
  await expect(page.locator('.mode-strip')).toContainText('1,000')
})

test('cashing out keeps the points', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/challenge/games/electrode-flip')
  await page.getByRole('button', { name: /Deal/ }).click()
  await flip(page, 5)
  await flip(page, 2)
  await page.getByRole('button', { name: 'Cash out 6 points' }).click()
  const over = page.locator('.ef-over')
  await expect(over).toContainText('Cashed out')
  await expect(over).toContainText('+6')
  await expect(over).toContainText('Next board: level 1 again')
})

test('memo marks stay on the player side', async ({ page }) => {
  const backend = await mockSupabase(page)
  await page.goto('/challenge/games/electrode-flip')
  await page.getByRole('button', { name: /Deal/ }).click()
  await page.getByRole('button', { name: 'Memo' }).click()
  await page.getByRole('button', { name: 'Electrode', exact: true }).click()
  await tile(page, 9).click()
  await expect(tile(page, 9).locator('.ef-marks')).toBeVisible()
  await expect(tile(page, 9)).toHaveAttribute('aria-label', 'Row 2, column 5: hidden, marked Electrode')
  // Right click marks too, without memo mode
  await page.getByRole('button', { name: 'Memo' }).click()
  await tile(page, 11).click({ button: 'right' })
  await expect(tile(page, 11).locator('.ef-marks')).toBeVisible()
  expect(backend.calls.filter((c) => c.path === '/rest/v1/rpc/electrode_flip_flip')).toHaveLength(0)
})

test('a board in progress is resumed after a reload', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/challenge/games/electrode-flip')
  await page.getByRole('button', { name: /Deal/ }).click()
  await flip(page, 5)
  await page.goto('/challenge/games')
  await expect(page.locator('.game-tile').filter({ hasText: 'Shiny Electrode Flip' })).toContainText('Resume')
  await page.goto('/challenge/games/electrode-flip')
  await expect(tile(page, 5)).toHaveClass(/is-up/)
  await expect(page.locator('.ef-tile.is-up')).toHaveCount(1)
  await expect(page.getByRole('button', { name: /Deal/ })).toHaveCount(0)
})

test('past the daily limit boards play for the record', async ({ page }) => {
  await mockSupabase(page, { electrodeFlip: { todayCoins: 300 } })
  await page.goto('/challenge/games/electrode-flip')
  await expect(page.getByText('No more coins today: play for the record.')).toBeVisible()
  await page.getByRole('button', { name: /Deal/ }).click()
  await expect(page.locator('.ef-chip')).toHaveText('For the record')
  for (const index of [2, 5, 18]) await flip(page, index)
  await expect(page.locator('.ef-over')).toContainText('No coins: today’s limit is reached.')
})

test('before migration 0014 the game says it is coming soon', async ({ page }) => {
  await mockSupabase(page, { electrodeFlip: 'missing' })
  await page.goto('/challenge/games')
  await expect(page.locator('.game-tile').filter({ hasText: 'Shiny Electrode Flip' })).toContainText('Coming soon')
  await page.goto('/challenge/games/electrode-flip')
  await expect(page.getByText('The mini-game is coming soon.')).toBeVisible()
})
