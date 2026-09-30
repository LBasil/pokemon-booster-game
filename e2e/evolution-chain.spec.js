import { expect, test } from '@playwright/test'
import { mockSupabase, signIn } from './support/supabase.js'

// "Evolution chain" (migration 0018). The mock asks EVOLUTION_QUESTIONS in
// order: Charmander's line (shown Charizard ex, Charmander, Charmeleon), then
// Squirtle's (Wartortle, Blastoise, Squirtle), then Bulbasaur's.
test.beforeEach(async ({ page }) => {
  await signIn(page)
})

const card = (page, name) => page.locator('.ec-card').filter({ has: page.locator('.ec-name', { hasText: new RegExp(`^${name}$`) }) })

test('the game is listed with the other mini-games', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/challenge/games')
  const tile = page.locator('.game-tile').filter({ hasText: 'Evolution chain' })
  await expect(tile).toContainText('3 paid runs left today')
  await tile.click()
  await expect(page).toHaveURL(/\/challenge\/games\/evolution-chain$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Evolution chain' })).toBeVisible()
  await expect(page.locator('a[href="/challenge/games"]:visible').first()).toHaveClass(/active|router-link-active/)
  await expect(page.locator('.ec-rules')).toContainText('3 coins per right answer')
})

test('evolution chain pays right orders until a wrong one', async ({ page }) => {
  const backend = await mockSupabase(page)
  await page.goto('/challenge/games/evolution-chain')

  await page.getByRole('button', { name: 'Play' }).click()
  await expect(page.getByRole('heading', { name: 'Put them in evolution order' })).toBeVisible()
  await expect(page.locator('.ec-card')).toHaveCount(3)
  await expect(page.locator('.ec-chip')).toHaveText('Paid run')

  // Picks are numbered, and a picked card can be taken back
  await card(page, 'Charmander').click()
  await expect(card(page, 'Charmander').locator('.ec-badge')).toHaveText('1')
  await expect(page.locator('.ec-slots li').first()).toContainText('Charmander')
  await card(page, 'Charizard ex').click()
  await expect(card(page, 'Charizard ex')).toHaveAttribute('aria-pressed', 'true')
  await card(page, 'Charizard ex').click()
  await expect(card(page, 'Charizard ex').locator('.ec-badge')).toHaveCount(0)

  // Right: the third pick sends the order
  await card(page, 'Charmeleon').click()
  await card(page, 'Charizard ex').click()
  await expect(page.locator('.ec-feedback')).toContainText('Perfect evolution!')
  await expect(page.locator('.ec-feedback')).toContainText('+3')
  await expect(page.locator('.mode-strip')).toContainText('1,003')

  // The next line comes by itself
  await expect(card(page, 'Blastoise')).toBeVisible()
  await expect(page.locator('.ec-streak')).toHaveText('Streak: 1')
  await card(page, 'Squirtle').click()
  await card(page, 'Blastoise').click()
  await card(page, 'Wartortle').click()
  await expect(page.locator('.ec-feedback')).toContainText('That’s not the order')
  await expect(page.locator('.ec-feedback')).toContainText('The line: Squirtle → Wartortle → Blastoise')
  await expect(card(page, 'Blastoise')).toHaveClass(/is-wrong/)
  await expect(card(page, 'Blastoise').locator('.ec-badge')).toHaveText('3')
  await expect(card(page, 'Squirtle')).not.toHaveClass(/is-wrong/)

  const over = page.locator('.ec-over')
  await expect(over).toContainText('Run over')
  await expect(over).toContainText('1 right answer')
  await expect(over).toContainText('New record!')
  await expect(over).toContainText('+3')
  await expect(page.getByText('2 paid runs left today')).toBeVisible()
  const answers = backend.calls.filter((c) => c.path === '/rest/v1/rpc/evolution_chain_answer').map((c) => JSON.parse(c.body))
  expect(answers).toEqual([
    { p_order: ['sv3pt5-4', 'sv3pt5-5', 'sv3pt5-6'] },
    { p_order: ['sv3pt5-7', 'sv3pt5-9', 'sv3pt5-8'] },
  ])

  await page.getByRole('button', { name: 'Play again' }).click()
  await expect(over).toBeHidden()
  await expect(page.locator('.ec-streak')).toHaveText('Streak: 0')
})

test('the number keys pick too, backspace takes the last one back', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/challenge/games/evolution-chain')
  await page.getByRole('button', { name: 'Play' }).click()
  await expect(card(page, 'Charmander')).toBeEnabled()
  await page.keyboard.press('1') // Charizard ex, Charmander, Charmeleon
  await page.keyboard.press('Backspace')
  await expect(page.locator('.ec-badge')).toHaveCount(0)
  await page.keyboard.press('2')
  await page.keyboard.press('3')
  await page.keyboard.press('1')
  await expect(page.locator('.ec-feedback')).toContainText('Perfect evolution!')
})

test('the run ends when time runs out', async ({ page }) => {
  await page.clock.install()
  const backend = await mockSupabase(page)
  await page.goto('/challenge/games/evolution-chain')
  await page.getByRole('button', { name: 'Play' }).click()
  await expect(card(page, 'Charmander')).toBeEnabled()
  await page.clock.fastForward('00:16')
  await expect(page.locator('.ec-over')).toContainText('Too slow!')
  await expect(page.locator('.ec-feedback')).toContainText('The line: Charmander → Charmeleon → Charizard ex')
  const answer = backend.calls.find((c) => c.path === '/rest/v1/rpc/evolution_chain_answer')
  expect(JSON.parse(answer.body)).toEqual({ p_order: null })
})

test('a run in progress is resumed after a reload', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/challenge/games/evolution-chain')
  await page.getByRole('button', { name: 'Play' }).click()
  await expect(card(page, 'Charmander')).toBeVisible()
  await page.goto('/challenge/games')
  await expect(page.locator('.game-tile').filter({ hasText: 'Evolution chain' })).toContainText('Resume the run')
  await page.goto('/challenge/games/evolution-chain')
  await expect(card(page, 'Charmander')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Play' })).toHaveCount(0)
})

test('the question fits a 320px screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await mockSupabase(page)
  await page.goto('/challenge/games/evolution-chain')
  await page.getByRole('button', { name: 'Play' }).click()
  await expect(page.locator('.ec-card')).toHaveCount(3)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
})

for (const [label, evolutionChain] of [
  ['before migration 0018', 'missing'],
  ['before the lines are loaded', { ready: false }],
]) {
  test(`${label} the game says it is coming soon`, async ({ page }) => {
    await mockSupabase(page, { evolutionChain })
    await page.goto('/challenge/games')
    const tile = page.locator('.game-tile').filter({ hasText: 'Evolution chain' })
    await expect(tile).toContainText('Coming soon')
    await expect(tile.locator('.game-cta')).toHaveCount(0)
    await page.goto('/challenge/games/evolution-chain')
    await expect(page.getByText('The mini-game is coming soon.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Play' })).toHaveCount(0)
  })
}
