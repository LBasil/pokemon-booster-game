import { expect, test } from '@playwright/test'
import { byId } from './support/data.js'
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

test('a player outside the top rows sees their own rank, or why they are not ranked', async ({ page }) => {
  await signIn(page)
  await mockSupabase(page, {
    leaderboard: [{ rank: 1, username: 'Misty', score: 24.5, packs: 40 }],
    myRank: { public: true, rank: 34, score: 4.5, packs: 60 },
  })
  await page.goto('/community')
  const me = page.locator('.board-me')
  await expect(me).toContainText('34')
  await expect(me).toContainText('You')
  await expect(me).toContainText('4.5 / 100 · 60 boosters')
})

test('a new player is told how to get on the board', async ({ page }) => {
  await signIn(page)
  await mockSupabase(page, { leaderboard: [{ rank: 1, username: 'Misty', score: 24.5, packs: 40 }] })
  await page.goto('/community')
  await expect(page.locator('.board-me')).toHaveCount(0)
  await expect(page.getByText("You're not ranked yet: 0/20 boosters opened.")).toBeVisible()
})

test('a private profile is told it stays off the leaderboards', async ({ page }) => {
  await signIn(page)
  await mockSupabase(page, { leaderboard: [{ rank: 1, username: 'Misty', score: 24.5, packs: 40 }], myRank: { public: false } })
  await page.goto('/community')
  await expect(page.locator('.board-me-note')).toContainText("Your profile is private, so you're not on the leaderboards.")
})

test("one player's run of pulls is one feed entry (the rarest), and the feed shows a few at a time", async ({ page }) => {
  const at = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString()
  const pull = (id, username, card, bucket) => ({ id, username, card_id: card, card_name: byId[card].name, image_small: byId[card].image_small, bucket, set_id: card.split('-')[0], mode: 'unlimited', pulled_at: at(id) })
  const feed = [
    pull(1, 'Bazouk', 'base1-4', 'holo'),
    pull(2, 'Bazouk', 'sv3pt5-199', 'secret'),
    pull(3, 'Bazouk', 'sv3pt5-6', 'holo'),
    pull(4, 'Misty', 'sv3pt5-6', 'holo'),
    ...Array.from({ length: 10 }, (_, i) => pull(10 + i, i % 2 ? 'Brock' : 'Gary', 'base1-4', 'holo')),
  ]
  await signIn(page)
  await mockSupabase(page, { feed })
  await page.goto('/community')
  const items = page.locator('.feed-list > .feed-item')
  await expect(items.first()).toContainText('Bazouk pulled Charizard ex and 2 more')
  await expect(items.first().locator('.feed-chip').first()).toHaveText('Secret rare')
  await expect(items).toHaveCount(8)
  await items.first().getByRole('button', { name: 'See all 3' }).click()
  await expect(items.first().locator('.feed-sub li')).toHaveCount(3)
  await page.getByRole('button', { name: 'Show more' }).click()
  await expect(items).toHaveCount(12)
  await expect(page.getByRole('button', { name: 'Show more' })).toHaveCount(0)
})
