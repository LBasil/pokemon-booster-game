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

test('every hit in the feed says which mode it was pulled in', async ({ page }) => {
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
  await expect(page.locator('.feed-item').nth(0).locator('.feed-mode')).toHaveText('Challenge')
  await expect(page.locator('.feed-item').nth(1).locator('.feed-mode')).toHaveText('Unlimited')

  await page.goto('/game')
  await expect(page.locator('.hub-live-item').nth(0).locator('.hub-live-mode')).toHaveText('Challenge')
  await expect(page.locator('.hub-live-item').nth(1).locator('.hub-live-mode')).toHaveText('Unlimited')
})

test('on a computer every leaderboard tab is reachable (no hidden overflow)', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'phones swipe the tab row')
  await signIn(page)
  await mockSupabase(page)
  await page.goto('/community')
  const tabs = page.locator('.board-tabs')
  const last = page.getByRole('tab').last()
  await expect(last).toBeVisible()
  const [box, lastBox] = await Promise.all([tabs.boundingBox(), last.boundingBox()])
  expect(lastBox.x + lastBox.width).toBeLessThanOrEqual(box.x + box.width + 1)
})
