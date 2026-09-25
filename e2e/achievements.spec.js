import { expect, test } from '@playwright/test'
import { mockSupabase, signIn } from './support/supabase.js'

test('the profile sums up achievements and leads to the full list', async ({ page }, info) => {
  await signIn(page)
  await mockSupabase(page)
  await page.goto('/profile')
  await expect(page.getByRole('heading', { name: 'Next up' })).toBeVisible()
  await page.getByRole('link', { name: /See all achievements/ }).click()
  await expect(page).toHaveURL(/\/achievements$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Achievements')
  await expect(page.getByRole('progressbar', { name: 'Overall progress' })).toBeVisible()
  await expect(page.getByText(/New achievements are added from time to time/)).toBeVisible()

  // No nav link of its own: lights up Profile, and has a way back
  const bar = info.project.name === 'mobile' ? page.locator('.app-tabbar') : page.locator('.app-header-nav')
  await expect(bar.getByRole('link', { name: 'Profile' })).toHaveAttribute('aria-current', 'page')
  await page.locator('.ach-back').click()
  await expect(page).toHaveURL(/\/profile$/)
})

test('achievements can be searched and filtered, in sync with the URL', async ({ page }) => {
  await signIn(page)
  await mockSupabase(page)
  await page.goto('/achievements')

  // The collection holds a Base Set Charizard
  await page.getByRole('searchbox', { name: 'Search an achievement' }).fill('charizard')
  await expect(page).toHaveURL(/q=charizard/)
  await expect(page.locator('.achv.unlocked').filter({ hasText: 'Flame on' })).toBeVisible()
  await expect(page.locator('.achv').filter({ hasText: 'Charizard hunter' })).toContainText('1 / 10')

  await page.getByRole('button', { name: 'Clear filters' }).click()
  await page.locator('.ach-cats').getByRole('button', { name: /History/ }).click()
  await expect(page).toHaveURL(/cat=history/)
  await expect(page.locator('.ach-group')).toHaveCount(1)
  await page.getByRole('group', { name: 'Show' }).getByRole('button', { name: 'Unlocked' }).click()
  await expect(page.locator('.achv:not(.unlocked)')).toHaveCount(0)
  await expect(page.locator('.achv').filter({ hasText: 'Where it all began' })).toBeVisible()

  // Reload keeps the filters
  await page.reload()
  await expect(page.locator('.ach-cats').getByRole('button', { name: /History/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.achv:not(.unlocked)')).toHaveCount(0)

  // Secret achievements don't give themselves away
  await page.goto('/achievements?cat=fun&status=locked')
  await expect(page.locator('.achv.secret').first()).toContainText('Secret achievement')
})

test('public achievements are readable signed out', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/u/misty')
  await page.getByRole('link', { name: /See all achievements/ }).click()
  await expect(page).toHaveURL(/\/u\/misty\/achievements$/i)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Misty’s achievements')
  await expect(page.locator('.achv.unlocked').filter({ hasText: 'Jackpot' })).toBeVisible()
})

test('opening a booster toasts the achievements it unlocks, once the cards are revealed', async ({ page }) => {
  await signIn(page)
  const backend = await mockSupabase(page)
  await page.goto('/boosters')
  await page.getByRole('button', { name: /Open 1 booster/ }).click()
  const pack = page.locator('.booster-pack')
  await expect(pack).toBeEnabled()
  // Already saved by the server, but nothing is spoiled before the reveal
  await expect(page.locator('.ach-toast')).toHaveCount(0)
  await pack.click({ force: true })
  const stack = page.locator('.card-stack')
  for (let i = 0; i < 30 && !(await page.locator('.done-layout').isVisible()); i++) {
    await expect(page.locator('.ach-toast')).toHaveCount(0)
    if (await stack.isVisible()) await stack.click({ force: true })
    await page.waitForTimeout(150)
  }

  // The pack's secret rare is a first; the Base Set Charizard was already owned (baseline)
  const toasts = page.locator('.ach-toast')
  await expect(toasts.filter({ hasText: 'Jackpot' })).toBeVisible()
  await expect(toasts.first()).toContainText('Achievement unlocked')
  await expect(toasts.filter({ hasText: 'Flame on' })).toHaveCount(0)
  expect(backend.state.recordedAchievements.has('secret1')).toBe(true)
  expect(backend.state.recordedAchievements.has('charizard')).toBe(true)

  // A toast leads to its category
  await toasts.filter({ hasText: 'Jackpot' }).getByRole('link').click()
  await expect(page).toHaveURL(/\/achievements\?cat=pulls$/)
})

test('achievements show how many players have them', async ({ page }) => {
  await signIn(page)
  await mockSupabase(page, {
    achievementRates: [
      { achievement_id: 'charizard', holders: 120, players: 400 },
      { achievement_id: 'baseSet', holders: 40, players: 400 },
      { achievement_id: 'wotc', holders: 1, players: 400 },
    ],
  })
  await page.goto('/achievements?cat=fun')
  await expect(page.locator('.achv').filter({ hasText: 'Flame on' })).toContainText('30% of players')
  await expect(page.locator('.achv').filter({ hasText: 'Charizard hunter' })).toContainText('No one has it yet')
  await page.goto('/achievements?cat=history')
  await expect(page.locator('.achv').filter({ hasText: 'Where it all began' })).toContainText('10% of players')
  await expect(page.locator('.achv').filter({ hasText: 'Old school' })).toContainText('Less than 1% of players')
})

test('without migration 0008 the achievements still work, just without rates', async ({ page }) => {
  await signIn(page)
  await mockSupabase(page, { achievementRates: 'missing' })
  await page.goto('/achievements')
  await expect(page.locator('.achv.unlocked').first()).toBeVisible()
  await expect(page.locator('.achv-rate')).toHaveCount(0)
})
