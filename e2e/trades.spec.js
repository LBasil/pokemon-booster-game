import { expect, test } from '@playwright/test'
import { byId, collectionEntry } from './support/data.js'
import { mockSupabase, signIn } from './support/supabase.js'

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

const rpcCalls = (backend, name) => backend.calls.filter((c) => c.path === `/rest/v1/rpc/${name}`)

const received = (overrides = {}) => ({
  id: 7,
  direction: 'received',
  partner: 'Misty',
  offer: [byId['base1-4']],
  request: [byId['sv3pt5-4']],
  status: 'pending',
  created_at: new Date().toISOString(),
  resolved_at: null,
  ...overrides,
})

test('a public profile leads to a prefilled offer, which is sent to the server', async ({ page }) => {
  const backend = await mockSupabase(page, { challengeCollection: [collectionEntry('sv3pt5-4', 2), collectionEntry('sv3pt5-7')] })
  await page.goto('/u/Misty')
  await page.getByRole('link', { name: 'Propose a trade to Misty' }).click()

  await expect(page).toHaveURL(/\/challenge\/trades\?to=Misty/)
  const give = page.getByRole('group', { name: /You give/ })
  const ask = page.getByRole('group', { name: /You ask Misty for/ })
  await give.getByRole('button', { name: 'Charmander' }).click()
  await ask.getByRole('button', { name: 'Charizard' }).click()
  await expect(give.getByText('1/5')).toBeVisible()

  await page.getByRole('button', { name: 'Send to Misty' }).click()
  await expect(page.getByText('Offer sent to Misty!')).toBeVisible()
  expect(JSON.parse(rpcCalls(backend, 'propose_trade')[0].body)).toEqual({
    p_username: 'Misty',
    p_offer: ['sv3pt5-4'],
    p_request: ['base1-4'],
  })
  // Now waiting for Misty, and cancellable
  await expect(page.getByRole('heading', { name: 'Waiting for an answer' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel offer' }).click()
  await expect(page.getByText('Offer cancelled.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Past trades' })).toBeVisible()
})

test('an unknown trainer gets a friendly message', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/challenge/trades')
  await page.getByLabel('Trainer').fill('Nobody')
  await page.getByRole('button', { name: 'Find' }).click()
  await expect(page.getByText("Nobody isn't a public trainer with a challenge collection.")).toBeVisible()
})

test('accepting an offer swaps the cards and clears the badge', async ({ page }) => {
  const backend = await mockSupabase(page, {
    challengeCollection: [collectionEntry('sv3pt5-4')],
    trades: [received()],
    badge: { rewards: 1, trades: 1 },
  })
  await page.goto('/challenge')
  // Badge: 1 reward + 1 offer on the Challenge link, the offer count on the trades tile
  await expect(page.locator('.ch-trades-count')).toHaveText('1 offer waiting')

  await page.locator('.ch-waiting').getByRole('link', { name: 'Open trades' }).click()
  const offer = page.locator('.trade').filter({ hasText: 'Misty' })
  await expect(offer.getByRole('img', { name: 'Charizard' })).toBeVisible()
  await offer.getByRole('button', { name: 'Accept' }).click()

  await expect(page.getByText('Trade done! The cards are in your collection.')).toBeVisible()
  expect(JSON.parse(rpcCalls(backend, 'respond_trade')[0].body)).toEqual({ p_trade_id: 7, p_accept: true })
  await expect(page.locator('.history-status')).toHaveText('Done')
  expect(backend.state.challengeCollection.map((e) => e.card_id)).toEqual(['base1-4'])
})

test('the navigation shows what is waiting in the challenge', async ({ page }, info) => {
  await mockSupabase(page, { badge: { rewards: 1, trades: 2 } })
  await page.goto('/game')
  const badge = info.project.name === 'mobile' ? page.locator('.tab-badge') : page.locator('.nav-badge')
  await expect(badge).toContainText('3')
})

test('challenge history lists challenge packs only, god packs flagged', async ({ page }) => {
  const backend = await mockSupabase(page)
  const opening = (id, mode, god_pack = false) => ({
    id,
    mode,
    set_id: 'sv3pt5',
    card_ids: ['sv3pt5-4', 'sv3pt5-199'],
    best_card_id: 'sv3pt5-199',
    hits: 1,
    secrets: 1,
    god_pack,
    opened_at: new Date().toISOString(),
  })
  backend.state.openings.push(opening(1, 'challenge', true), opening(2, 'unlimited'))

  await page.goto('/challenge')
  await page.getByRole('link', { name: 'Booster history' }).click()
  await expect(page).toHaveURL(/\/challenge\/history/)
  await expect(page.locator('.history-item')).toHaveCount(1)
  await expect(page.locator('.history-god')).toHaveText('God pack!')

  await page.goto('/history')
  await expect(page.locator('.history-item')).toHaveCount(1)
  await expect(page.locator('.history-god')).toHaveCount(0)
})

test('the community has challenge leaderboards', async ({ page }) => {
  const backend = await mockSupabase(page, {
    leaderboard: [{ rank: 1, username: 'Misty', score: 42, packs: 30, card_id: null, card_name: null, image_small: null }],
  })
  await page.goto('/community')
  await page.getByRole('tab', { name: 'Challenge: cards' }).click()
  await expect(page.locator('.board-score').first()).toHaveText('42 cards')
  expect(rpcCalls(backend, 'leaderboard').some((c) => JSON.parse(c.body).p_kind === 'challenge_unique')).toBe(true)
})
