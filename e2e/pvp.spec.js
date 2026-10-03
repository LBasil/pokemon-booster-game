import { expect, test } from '@playwright/test'
import { collectionEntry } from './support/data.js'
import { mockSupabase, signIn } from './support/supabase.js'

// PvP battles (migration 0024). In the mock every challenge Pokémon deals 30
// (Fire, 60 HP) and Misty's deck is PVP_OPPONENT_DECK: 5 Grass cards weak to
// Fire (one hit each, Oddish first) that deal 20.
test.beforeEach(async ({ page }) => {
  await signIn(page)
})

const FIVE = ['sv3pt5-4', 'sv3pt5-7', 'sv3pt5-1', 'sv3pt5-25', 'sv3pt5-5']
const challengeCollection = [...FIVE, 'sv3pt5-150', 'sv3pt5-190'].map((id) => collectionEntry(id))

test('PvP is listed with the mini-games', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/challenge/games')
  const tile = page.locator('.game-tile').filter({ hasText: 'PvP battles' })
  await expect(tile).toContainText('10 battles left today')
  await tile.click()
  await expect(page).toHaveURL(/\/challenge\/games\/pvp$/)
  await expect(page.getByRole('heading', { level: 1, name: 'PvP battles' })).toBeVisible()
  await expect(page.locator('a[href="/challenge/games"]:visible').first()).toHaveClass(/active|router-link-active/)
  await expect(page.locator('.pvp-rules')).toContainText('No coins')
})

test('build a deck, attack and win Elo', async ({ page }) => {
  const backend = await mockSupabase(page, { challengeCollection })
  await page.goto('/challenge/games/pvp')

  // No deck yet: the button to fight waits for one
  await expect(page.locator('.pvp-deck')).toContainText('You have 6 cards that can fight here')
  await expect(page.getByRole('button', { name: 'Find an opponent' })).toBeDisabled()

  await page.getByRole('button', { name: 'Build my deck' }).click()
  const picks = page.locator('.pvp-pick')
  await expect(picks).toHaveCount(6) // the Trainer can't fight
  await expect(page.getByRole('button', { name: 'Save the deck' })).toBeDisabled()
  for (const name of ['Charmander', 'Squirtle', 'Bulbasaur', 'Pikachu', 'Charmeleon']) {
    await picks.filter({ hasText: name }).click()
  }
  await expect(page.locator('.pvp-count')).toHaveText('5 / 5')
  await expect(picks.filter({ hasText: 'Mewtwo' })).toBeDisabled()
  await page.getByRole('button', { name: 'Save the deck' }).click()
  await expect(page.locator('.pvp-deck .pvp-row > li')).toHaveCount(5)
  const saved = backend.calls.find((call) => call.path === '/rest/v1/rpc/pvp_save_deck')
  expect(JSON.parse(saved.body)).toEqual({ p_format: 'all', p_cards: FIVE })

  // The battle: their deck is hidden
  await page.getByRole('button', { name: 'Find an opponent' }).click()
  await expect(page.getByRole('heading', { name: /Against Misty/ })).toBeVisible()
  await expect(page.locator('.pvp-theirs .is-hidden')).toHaveCount(5)

  const mine = page.locator('.pvp-play')
  await mine.nth(0).click()
  await expect(page.locator('.pvp-feedback')).toContainText('Your Charmander hit Oddish for 60.')
  await expect(page.locator('.pvp-feedback')).toContainText('Oddish is knocked out!')
  await expect(page.locator('.pvp-theirs .is-hidden')).toHaveCount(4)
  await expect(page.locator('.pvp-theirs')).toContainText('Oddish')
  await expect(page.locator('.pvp-score')).toContainText('1 / 3')
  await mine.nth(0).click()
  await mine.nth(1).click()

  await expect(page.locator('.pvp-feedback')).toContainText('You win!')
  await expect(page.locator('.pvp-feedback')).toContainText('Elo +16')
  // Over: their whole deck shows, no card can play
  await expect(page.locator('.pvp-theirs .is-hidden')).toHaveCount(0)
  await expect(page.locator('.pvp-theirs > li')).toHaveCount(5)
  await expect(mine.first()).toBeDisabled()

  await page.getByRole('button', { name: 'Back to battles' }).click()
  await expect(page.locator('.pvp-history')).toContainText('You attacked Misty')
  await expect(page.locator('.pvp-history')).toContainText('+16')
  await expect(page.locator('.pvp-stats')).toContainText('1016')
  await expect(page.locator('.pvp-stats')).toContainText('100%')
  await expect(page.locator('.pvp-start')).toContainText('9 battles left today')
})

test('a battle in progress comes back, and giving up asks first', async ({ page }) => {
  const backend = await mockSupabase(page, { challengeCollection })
  await page.goto('/challenge/games/pvp')
  await page.getByRole('button', { name: 'Build my deck' }).click()
  for (const name of ['Charmander', 'Squirtle', 'Bulbasaur', 'Pikachu', 'Charmeleon']) await page.locator('.pvp-pick').filter({ hasText: name }).click()
  await page.getByRole('button', { name: 'Save the deck' }).click()
  await page.getByRole('button', { name: 'Find an opponent' }).click()
  await page.locator('.pvp-play').first().click()
  await expect(page.locator('.pvp-feedback')).toContainText('Oddish is knocked out!')

  await page.reload()
  await expect(page.getByRole('heading', { name: /Against Misty/ })).toBeVisible()
  await expect(page.locator('.pvp-score')).toContainText('1 / 3')

  await page.getByRole('button', { name: 'Give up' }).click()
  expect(backend.calls.some((call) => call.path === '/rest/v1/rpc/pvp_forfeit')).toBe(false)
  await page.getByRole('button', { name: 'Sure? Give up (a loss)' }).click()
  await expect(page.locator('.pvp-feedback')).toContainText('You gave up.')
  await expect(page.locator('.pvp-feedback')).toContainText('Elo -16')
})

test('formats: one era or one set, and no opponent says why', async ({ page }) => {
  await mockSupabase(page, {
    challengeCollection,
    pvp: { opponent: false, decks: { 'era:Scarlet & Violet': { cards: [], valid: true } } },
  })
  await page.goto('/challenge/games/pvp')
  const kinds = page.getByRole('tablist', { name: 'Format' })
  await kinds.getByRole('tab', { name: 'One era' }).click()
  await expect(page.getByLabel('Era', { exact: true })).toHaveValue('era:Scarlet & Violet')
  await expect(page.getByLabel('Era', { exact: true }).locator('option')).toHaveText(['Base (no card)', 'Scarlet & Violet (6 cards)'])
  await page.getByRole('button', { name: 'Find an opponent' }).click()
  await expect(page.getByRole('alert')).toContainText('No opponent in this format yet')

  await kinds.getByRole('tab', { name: 'One set' }).click()
  await expect(page.getByLabel('Set', { exact: true })).toHaveValue('set:sv3pt5')
  await expect(page.locator('.pvp-board-skeleton, .pvp-panel')).not.toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Ranking: 151' })).toBeVisible()
  // Remembered on this device
  await page.reload()
  await expect(page.getByLabel('Set', { exact: true })).toHaveValue('set:sv3pt5')
})

test('before the migration, PvP says it is coming', async ({ page }) => {
  await mockSupabase(page, { pvp: 'missing' })
  await page.goto('/challenge/games/pvp')
  await expect(page.getByText('PvP battles are coming soon.')).toBeVisible()
  await page.goto('/challenge/games')
  await expect(page.locator('.game-tile').filter({ hasText: 'PvP battles' })).toContainText('Coming soon')
})
