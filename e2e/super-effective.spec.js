import { expect, test } from '@playwright/test'
import { mockSupabase, signIn } from './support/supabase.js'

// "Super effective!" (migration 0015). The mock asks SUPER_EFFECTIVE_QUESTIONS
// in order: Charmander (Water), Squirtle (Lightning), Bulbasaur (Fire).
test.beforeEach(async ({ page }) => {
  await signIn(page)
})

const option = (page, type) => page.locator(`.se-option[data-type="${type}"]`)

test('the game is listed with the other mini-games', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/challenge/games')
  const tile = page.locator('.game-tile').filter({ hasText: 'Super effective!' })
  await expect(tile).toContainText('3 paid runs left today')
  await tile.click()
  await expect(page).toHaveURL(/\/challenge\/games\/super-effective$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Super effective!' })).toBeVisible()
  await expect(page.locator('a[href="/challenge/games"]:visible').first()).toHaveClass(/active|router-link-active/)
})

test('super effective pays right answers until a wrong one', async ({ page }) => {
  const backend = await mockSupabase(page)
  await page.goto('/challenge/games/super-effective')

  await page.getByRole('button', { name: 'Play' }).click()
  await expect(page.getByRole('heading', { name: 'What is it weak to?' })).toBeVisible()
  await expect(page.locator('.se-card')).toContainText('Charmander')
  await expect(page.locator('.se-card')).toContainText('Fire') // its type
  await expect(page.locator('.se-option')).toHaveCount(3)
  await expect(page.locator('.se-chip')).toHaveText('Paid run')

  // Right: Charmander is weak to Water
  await option(page, 'Water').click()
  await expect(page.locator('.se-feedback')).toContainText("It's super effective!")
  await expect(page.locator('.se-feedback')).toContainText('+5')
  await expect(option(page, 'Water')).toHaveClass(/is-answer/)
  await expect(page.locator('.mode-strip')).toContainText('1,005')

  // The next card comes by itself
  await expect(page.locator('.se-card')).toContainText('Squirtle')
  await expect(page.locator('.se-streak')).toHaveText('Streak: 1')
  await option(page, 'Fire').click()
  await expect(page.locator('.se-feedback')).toContainText('Not very effective')
  await expect(page.locator('.se-feedback')).toContainText('Weak to: Lightning')
  await expect(option(page, 'Fire')).toHaveClass(/is-wrong/)
  await expect(option(page, 'Lightning')).toHaveClass(/is-answer/)

  const over = page.locator('.se-over')
  await expect(over).toContainText('Run over')
  await expect(over).toContainText('1 right answer')
  await expect(over).toContainText('New record!')
  await expect(over).toContainText('+5')
  await expect(page.getByText('2 paid runs left today')).toBeVisible()
  const answers = backend.calls.filter((c) => c.path === '/rest/v1/rpc/super_effective_answer').map((c) => JSON.parse(c.body))
  expect(answers).toEqual([{ p_pick: 'Water' }, { p_pick: 'Fire' }])

  await page.getByRole('button', { name: 'Play again' }).click()
  await expect(over).toBeHidden()
  await expect(page.locator('.se-streak')).toHaveText('Streak: 0')
})

test('the number keys answer too', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/challenge/games/super-effective')
  await page.getByRole('button', { name: 'Play' }).click()
  await expect(option(page, 'Water')).toBeEnabled()
  await page.keyboard.press('2') // Grass, Water, Psychic
  await expect(page.locator('.se-feedback')).toContainText("It's super effective!")
})

test('the run ends when time runs out', async ({ page }) => {
  await page.clock.install()
  const backend = await mockSupabase(page)
  await page.goto('/challenge/games/super-effective')
  await page.getByRole('button', { name: 'Play' }).click()
  await expect(option(page, 'Water')).toBeEnabled()
  await page.clock.fastForward('00:11')
  await expect(page.locator('.se-over')).toContainText('Too slow!')
  await expect(page.locator('.se-feedback')).toContainText('Weak to: Water')
  const answer = backend.calls.find((c) => c.path === '/rest/v1/rpc/super_effective_answer')
  expect(JSON.parse(answer.body)).toEqual({ p_pick: null })
})

test('a run in progress is resumed after a reload', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/challenge/games/super-effective')
  await page.getByRole('button', { name: 'Play' }).click()
  await expect(page.locator('.se-card')).toContainText('Charmander')
  await page.goto('/challenge/games')
  await expect(page.locator('.game-tile').filter({ hasText: 'Super effective!' })).toContainText('Resume the run')
  await page.goto('/challenge/games/super-effective')
  await expect(page.locator('.se-card')).toContainText('Charmander')
  await expect(page.getByRole('button', { name: 'Play' })).toHaveCount(0)
})

test('the question fits a 320px screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await mockSupabase(page)
  await page.goto('/challenge/games/super-effective')
  await page.getByRole('button', { name: 'Play' }).click()
  await expect(page.locator('.se-option')).toHaveCount(3)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
})

for (const [label, superEffective] of [
  ['before migration 0015', 'missing'],
  ['before the weaknesses are loaded', { ready: false }],
]) {
  test(`${label} the game says it is coming soon`, async ({ page }) => {
    await mockSupabase(page, { superEffective })
    await page.goto('/challenge/games')
    const tile = page.locator('.game-tile').filter({ hasText: 'Super effective!' })
    await expect(tile).toContainText('Coming soon')
    await expect(tile.locator('.game-cta')).toHaveCount(0)
    await page.goto('/challenge/games/super-effective')
    await expect(page.getByText('The mini-game is coming soon.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Play' })).toHaveCount(0)
  })
}
