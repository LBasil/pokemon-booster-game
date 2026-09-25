import { expect, test } from '@playwright/test'
import { collectionEntry } from './support/data.js'
import { mockSupabase, signIn } from './support/supabase.js'

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

const rpcCalls = (backend, name) => backend.calls.filter((c) => c.path === `/rest/v1/rpc/${name}`)

test('the hub leads to the challenge, which shows the wallet and claims the daily reward', async ({ page }) => {
  const backend = await mockSupabase(page)
  await page.goto('/game')
  await page.getByRole('link', { name: /Take on the challenge/ }).click()

  await expect(page).toHaveURL(/\/challenge$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Every pack counts')
  const wallet = page.locator('.ch-coins')
  await expect(wallet).toContainText('1,000')

  await page.getByRole('button', { name: /Claim/ }).first().click()
  await expect(page.getByRole('status').filter({ hasText: '+200 coins!' })).toBeVisible()
  await expect(wallet).toContainText('1,200')
  await expect(page.getByText(/Claimed! Next reward in/)).toBeVisible()
  expect(rpcCalls(backend, 'claim_daily_reward')).toHaveLength(1)
})

test('a finished mission can be claimed, an unfinished one cannot', async ({ page }) => {
  await mockSupabase(page, { challenge: { progress: { open_packs: 3, pull_holo: 0, recycle: 0 } } })
  await page.goto('/challenge')

  const open = page.locator('.ch-mission').filter({ hasText: 'Open 3 boosters' })
  const holo = page.locator('.ch-mission').filter({ hasText: 'Pull a holo or better' })
  await expect(holo.getByRole('button')).toBeDisabled()
  await open.getByRole('button').click()
  await expect(open).toContainText('Claimed')
  await expect(page.locator('.ch-coins')).toContainText('1,075')
})

test('challenge boosters cost coins and go to the challenge collection only', async ({ page }) => {
  const backend = await mockSupabase(page)
  await page.goto('/challenge/boosters')
  await expect(page.locator('.wallet-balance')).toContainText('1,000')

  await page.getByRole('radio', { name: '3', exact: true }).click()
  await page.getByRole('button', { name: /Open 3 boosters/ }).click()
  await page.getByRole('button', { name: /Open all 3 at once/ }).click()

  await expect(page.locator('.done-layout')).toBeVisible()
  await expect(page.locator('.done-wallet')).toContainText('700')
  expect(rpcCalls(backend, 'open_challenge_booster')).toHaveLength(3)
  expect(rpcCalls(backend, 'open_my_booster')).toHaveLength(0)

  await page.getByRole('link', { name: 'My collection' }).click()
  await expect(page).toHaveURL(/\/challenge\/collection/)
  await expect(page.locator('.coll-card')).toHaveCount(10)
  // The unlimited collection is a different one
  await page.goto('/collection')
  await expect(page.locator('.coll-card')).toHaveCount(2)
})

test('a god pack is announced once torn open', async ({ page }) => {
  await mockSupabase(page, { godPack: true })
  await page.goto('/challenge/boosters')
  await page.getByRole('button', { name: /Open 1 booster/ }).click()
  const pack = page.locator('.booster-pack')
  await expect(pack).toBeEnabled()
  await pack.click({ force: true })
  await expect(page.locator('.pack-banner')).toHaveText('God pack!')
})

test('without enough coins the open button is disabled and points to rewards', async ({ page }) => {
  const backend = await mockSupabase(page, { challenge: { coins: 250 } })
  await page.goto('/challenge/boosters')
  await expect(page.getByRole('radio', { name: '3', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: /Open 1 booster/ })).toBeEnabled()

  backend.state.challenge.coins = 50
  await page.goto('/challenge/boosters')
  await expect(page.getByRole('button', { name: /Open 1 booster/ })).toBeDisabled()
  await page.getByRole('link', { name: 'Earn coins' }).click()
  await expect(page).toHaveURL(/\/challenge$/)
})

test('recycling duplicates keeps one copy and pays coins', async ({ page }) => {
  const backend = await mockSupabase(page, {
    challengeCollection: [collectionEntry('sv3pt5-4', 4), collectionEntry('sv3pt5-199', 2), collectionEntry('base1-4')],
  })
  await page.goto('/challenge/collection')
  await expect(page.getByText('4 duplicates to recycle')).toBeVisible()

  await page.getByRole('button', { name: 'Recycle duplicates' }).click()
  await page.getByRole('button', { name: 'Yes, recycle them' }).click()
  await expect(page.getByText('4 duplicates recycled: +203 coins')).toBeVisible()
  await expect(page.getByText('No duplicates to recycle.')).toBeVisible()
  await expect(page.locator('.coll-balance')).toContainText('1,203')
  expect(rpcCalls(backend, 'recycle_duplicates')).toHaveLength(1)
})

test('a missing card can be crafted from the binder', async ({ page }) => {
  const backend = await mockSupabase(page, { challengeCollection: [collectionEntry('sv3pt5-4')] })
  await page.goto('/challenge/collection/set/sv3pt5')

  await page.getByRole('button', { name: /Mewtwo/ }).click()
  const detail = page.locator('dialog.card-detail')
  await detail.getByRole('button', { name: /Craft/ }).click()
  await expect(detail.getByText('Mewtwo crafted and added to your collection!')).toBeVisible()
  await expect(detail.getByText('1 copy')).toBeVisible()
  expect(JSON.parse(rpcCalls(backend, 'craft_card')[0].body)).toEqual({ p_card_id: 'sv3pt5-150' })
  // Secret rares cost more than this wallet holds
  await page.keyboard.press('Escape')
  await expect(detail).toBeHidden()
  await page.getByRole('button', { name: /Giovanni/ }).click()
  await expect(detail.getByRole('button', { name: /Craft/ })).toBeDisabled()
})
