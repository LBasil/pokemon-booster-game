import { expect, test } from '@playwright/test'
import { collectionEntry } from './support/data.js'
import { mockSupabase, signIn } from './support/supabase.js'

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

const CHALLENGE_PAGES = ['/challenge', '/challenge/boosters', '/challenge/collection', '/challenge/collection/set/sv3pt5', '/challenge/history', '/challenge/trades', '/challenge/achievements']

test('every challenge page says so and leads back to unlimited mode in one tap', async ({ page }) => {
  await mockSupabase(page)
  for (const path of CHALLENGE_PAGES) {
    await page.goto(path)
    const strip = page.locator('.mode-strip')
    await expect(strip, path).toContainText('Challenge mode')
    await expect(strip.getByRole('link', { name: /Leave/ }), path).toBeInViewport()
  }
  await page.locator('.mode-strip').getByRole('link', { name: /Leave/ }).click()
  await expect(page).toHaveURL(/\/game$/)
  await expect(page.locator('.mode-strip')).toHaveCount(0)
})

test('community and profile keep the mode the player came from', async ({ page }, info) => {
  await mockSupabase(page)
  const bar = info.project.name === 'mobile' ? page.locator('.app-tabbar') : page.locator('.app-header-nav')
  await page.goto('/challenge')
  await bar.getByRole('link', { name: 'Profile' }).click()
  await expect(page).toHaveURL(/\/profile$/)
  await expect(page.locator('.mode-strip')).toContainText('Challenge mode')
  await expect(bar.getByRole('link', { name: 'Profile' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('link', { name: 'My booster history' })).toHaveAttribute('href', '/challenge/history')
  // Still there after a reload, and on the community page
  await page.reload()
  await expect(page.locator('.mode-strip')).toBeVisible()
  await page.goto('/community')
  await expect(page.locator('.mode-strip')).toBeVisible()
  await expect(page.getByRole('tab', { selected: true })).toHaveText('Challenge: cards')

  await page.locator('.mode-strip').getByRole('link', { name: /Leave/ }).click()
  await expect(page).toHaveURL(/\/game$/)
  await page.goto('/community')
  await expect(page.locator('.mode-strip')).toHaveCount(0)
})

test('logging out takes a labeled button on the profile, never a stray header icon', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/game')
  await expect(page.locator('.app-header').getByRole('button', { name: 'Log out' })).toHaveCount(0)
  await page.goto('/profile')
  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page).toHaveURL(/\/$/)
})

test('the mode switch moves between the two hubs', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/game')
  const modes = page.getByRole('navigation', { name: 'Game mode' })
  await expect(modes.getByRole('link', { name: 'Unlimited' })).toHaveAttribute('aria-current', 'page')
  await modes.getByRole('link', { name: 'Challenge' }).click()
  await expect(page).toHaveURL(/\/challenge$/)
  await expect(page.getByRole('navigation', { name: 'Game mode' }).getByRole('link', { name: 'Challenge' })).toHaveAttribute('aria-current', 'page')
  await page.getByRole('navigation', { name: 'Game mode' }).getByRole('link', { name: 'Unlimited' }).click()
  await expect(page).toHaveURL(/\/game$/)
})

test('an empty challenge collection says the unlimited cards are safe', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/challenge/collection')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Challenge collection')
  await expect(page.getByText('Your 2 cards in unlimited mode are all still there.')).toBeVisible()
  await page.getByRole('link', { name: 'My unlimited collection' }).click()
  await expect(page).toHaveURL(/\/collection$/)
  await expect(page.locator('.coll-card')).toHaveCount(2)
})

test('a badge always comes with its reason, one tap away', async ({ page }, info) => {
  await mockSupabase(page, { badge: { rewards: 1, trades: 2 } })
  await page.goto('/game')
  const tile = page.locator('.hub-challenge')
  await expect(tile).toContainText('1 reward to claim')
  await expect(tile).toContainText('2 offers waiting')
  if (info.project.name === 'mobile') {
    // The badge sits on the Home tab: its reason must show without scrolling
    await expect(tile.getByText('1 reward to claim')).toBeInViewport()
  } else {
    // The badge sits on the Challenge link, which opens the challenge hub
    await page.locator('.app-header-nav').getByRole('link', { name: /Challenge/ }).click()
    await expect(page.getByRole('button', { name: /Claim/ }).first()).toBeInViewport()
  }
})

test('history has a way back and lights up its parent tab', async ({ page }, info) => {
  await mockSupabase(page)
  await page.goto('/history')
  const bar = info.project.name === 'mobile' ? page.locator('.app-tabbar') : page.locator('.app-header-nav')
  await expect(bar.getByRole('link', { name: 'Profile' })).toHaveAttribute('aria-current', 'page')
  await page.locator('.history-back').click()
  await expect(page).toHaveURL(/\/profile$/)

  await page.goto('/challenge/history')
  await expect(page.locator('.history-back')).toHaveText(/Challenge home/)
  await page.locator('.history-back').click()
  await expect(page).toHaveURL(/\/challenge$/)
})

// Regression: recycling used to swap the page for its loading skeleton for good
test('recycling from the challenge hub keeps the page on screen', async ({ page }) => {
  await mockSupabase(page, { challengeCollection: [collectionEntry('sv3pt5-4', 43)] })
  await page.goto('/challenge')
  await page.getByRole('button', { name: 'Recycle duplicates' }).click()
  await page.getByRole('button', { name: 'Yes, recycle them' }).click()
  await expect(page.getByText('42 duplicates recycled: +42 coins')).toBeVisible()
  await expect(page.locator('.ch-mission')).toHaveCount(7) // 3 daily + 4 weekly
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0)
  await expect(page.locator('.ch-coins')).toContainText('1,042')
})

// Regression: after opening challenge packs, "Change set" left the open button disabled
test('after a challenge opening, another one can be started', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/challenge/boosters')
  await page.getByRole('radio', { name: '3', exact: true }).click()
  await page.getByRole('button', { name: /Open 3 boosters/ }).click()
  await page.getByRole('button', { name: /Open all 3 at once/ }).click()
  await page.getByRole('button', { name: 'Change set' }).click()
  await expect(page.getByRole('button', { name: /Open 3 boosters/ })).toBeEnabled()
})

// Regression: the community leaderboard tabs once made the page 628px wide on phones
test('no page scrolls sideways', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'phone layout')
  await mockSupabase(page, { challengeCollection: [collectionEntry('sv3pt5-4')] })
  const pages = ['/game', '/boosters', '/collection', '/collection?view=sets', '/collection?view=pokedex', '/collection/set/sv3pt5', '/history', '/profile', '/achievements', '/community', '/u/misty', ...CHALLENGE_PAGES]
  for (const path of pages) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    const [scroll, width] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth])
    expect(scroll, path).toBeLessThanOrEqual(width)
  }
})
