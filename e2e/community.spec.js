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
