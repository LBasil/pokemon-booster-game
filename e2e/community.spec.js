import { expect, test } from '@playwright/test'
import { mockSupabase, signIn } from './support/supabase.js'

test('community shows the live feed and the leaderboards', async ({ page }) => {
  await signIn(page)
  await mockSupabase(page)
  await page.goto('/community')
  await expect(page.locator('.feed-item').first()).toContainText('Misty')
  await expect(page.locator('.feed-item').first()).toContainText('Charizard ex')
  await expect(page.locator('.board-row')).toHaveCount(2)
  await expect(page.locator('.board-row.mine')).toContainText('Ash')

  await page.getByRole('link', { name: 'Misty' }).first().click()
  await expect(page).toHaveURL('/u/Misty')
})

test('the feed switches between challenge and unlimited pulls, each saying its mode', async ({ page }) => {
  const at = new Date().toISOString()
  const hit = { card_id: 'sv3pt5-199', card_name: 'Charizard ex', image_small: null, bucket: 'secret', set_id: 'sv3pt5', pulled_at: at }
  await signIn(page)
  await mockSupabase(page, {
    feed: [
      { ...hit, id: 1, username: 'Misty', mode: 'challenge' },
      { ...hit, id: 2, username: 'Brock', mode: 'unlimited' },
    ],
  })
  await page.goto('/community')
  // One mode at a time: the switch opens on the mode the player came from
  const feedModes = page.locator('.feed-modes')
  await expect(feedModes.getByRole('tab', { name: 'Unlimited' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.feed-item')).toHaveCount(1)
  await expect(page.locator('.feed-item').locator('.feed-mode')).toHaveText('Unlimited')
  await expect(page.locator('.feed-item')).toContainText('Brock')

  await feedModes.getByRole('tab', { name: 'Challenge' }).click()
  await expect(page.locator('.feed-item')).toHaveCount(1)
  await expect(page.locator('.feed-item').locator('.feed-mode')).toHaveText('Challenge')
  await expect(page.locator('.feed-item')).toContainText('Misty')

  await page.goto('/game')
  await expect(page.locator('.hub-live-item').nth(0).locator('.hub-live-mode')).toHaveText('Challenge')
  await expect(page.locator('.hub-live-item').nth(1).locator('.hub-live-mode')).toHaveText('Unlimited')
})

test('the leaderboards switch between the challenge and unlimited boards', async ({ page }) => {
  await signIn(page)
  await mockSupabase(page)
  await page.goto('/community')
  const modes = page.locator('.board-modes')
  const boards = page.locator('.board-tabs [role="tab"]')
  await expect(modes.getByRole('tab', { name: 'Unlimited' })).toHaveAttribute('aria-selected', 'true')
  await expect(boards).toHaveText(['Luckiest', 'Best pull', 'Master sets'])

  const request = page.waitForRequest((req) => req.url().includes('/rpc/leaderboard') && req.postData()?.includes('challenge_unique'))
  await modes.getByRole('tab', { name: 'Challenge' }).click()
  await request
  await expect(boards).toHaveText(['Most cards', 'Collection value'])
  await boards.nth(1).click()

  // Each mode keeps the board it was on
  await modes.getByRole('tab', { name: 'Unlimited' }).click()
  await expect(boards.nth(0)).toHaveAttribute('aria-selected', 'true')
  await modes.getByRole('tab', { name: 'Challenge' }).click()
  await expect(boards.nth(1)).toHaveAttribute('aria-selected', 'true')
})

test('coming from the challenge, the leaderboards open on its boards', async ({ page }) => {
  await signIn(page)
  await mockSupabase(page)
  await page.goto('/challenge')
  await page.goto('/community')
  await expect(page.locator('.board-modes').getByRole('tab', { name: 'Challenge' })).toHaveAttribute('aria-selected', 'true')
})

test('on a computer every leaderboard tab is reachable (no hidden overflow)', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'phones swipe the tab row')
  await signIn(page)
  await mockSupabase(page)
  await page.goto('/community')
  const tabs = page.locator('.board-tabs')
  const last = tabs.getByRole('tab').last()
  await expect(last).toBeVisible()
  const [box, lastBox] = await Promise.all([tabs.boundingBox(), last.boundingBox()])
  expect(lastBox.x + lastBox.width).toBeLessThanOrEqual(box.x + box.width + 1)
})
