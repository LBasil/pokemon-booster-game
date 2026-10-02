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

test('typing a few letters suggests trainers, picking one opens their cards', async ({ page }) => {
  await mockSupabase(page, { challengeCollection: [collectionEntry('sv3pt5-4', 2), collectionEntry('base1-4')] })
  await page.goto('/challenge/trades')
  await page.getByLabel('Trainer').pressSequentially('mis')
  const suggestions = page.getByRole('listbox', { name: 'Suggestions' })
  await expect(suggestions.getByRole('option')).toHaveCount(2)
  await expect(suggestions.getByRole('option', { name: /Mistral/ })).toContainText("Doesn't accept trades")

  // Keyboard: first suggestion + Enter
  await page.getByLabel('Trainer').press('ArrowDown')
  await page.getByLabel('Trainer').press('Enter')
  await expect(page.getByLabel('Trainer')).toHaveValue('Misty')
  await expect(suggestions).toBeHidden()

  // Copies I own, on both sides
  const give = page.getByRole('group', { name: /You give/ })
  const ask = page.getByRole('group', { name: /You ask Misty for/ })
  await expect(give.getByRole('button', { name: /Charmander/ })).toContainText('You have 2')
  await expect(ask.getByRole('button', { name: /Charizard/ })).toContainText('You have 1')
  await expect(ask.getByRole('button', { name: /Mewtwo/ })).toContainText('New for you')
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
  await page.getByRole('tablist', { name: 'Game mode' }).getByRole('tab', { name: 'Challenge' }).click()
  await page.getByRole('tablist', { name: 'Leaderboards' }).getByRole('tab', { name: 'Most cards' }).click()
  await expect(page.locator('.board-score').first()).toHaveText('42 cards')
  expect(rpcCalls(backend, 'leaderboard').some((c) => JSON.parse(c.body).p_kind === 'challenge_unique')).toBe(true)
})

test('a public profile shows its challenge collection, and a card can be asked for', async ({ page }) => {
  await mockSupabase(page, { challengeCollection: [collectionEntry('sv3pt5-4')] })
  await page.goto('/u/Misty')
  const panel = page.locator('section', { has: page.getByRole('heading', { name: 'Challenge collection' }) })
  await expect(panel).toContainText('2 cards')
  await panel.locator('.challenge-card', { hasText: 'Charizard' }).getByRole('link', { name: 'Ask for it' }).click()

  await expect(page).toHaveURL(/\/challenge\/trades\?to=Misty&want=base1-4/)
  const ask = page.getByRole('group', { name: /You ask Misty for/ })
  await expect(ask.getByText('1/5')).toBeVisible() // Charizard already picked
})

test('a trainer who refuses trades says so, and no offer can be started', async ({ page }) => {
  await mockSupabase(page, { mistyAcceptsTrades: false })
  await page.goto('/u/Misty')
  await expect(page.getByText('Misty doesn’t accept trades.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Propose a trade to Misty' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Ask for it' })).toHaveCount(0)

  await page.goto('/challenge/trades?to=Misty')
  await expect(page.getByText('Misty doesn’t accept trades.')).toBeVisible()
  await expect(page.getByRole('group', { name: /You ask Misty for/ })).toHaveCount(0)
})

test('cards kept out of trades can be neither asked for nor offered', async ({ page }) => {
  const backend = await mockSupabase(page, { mistyLocks: ['base1-4'], challengeCollection: [collectionEntry('sv3pt5-4'), collectionEntry('sv3pt5-7')] })
  await page.goto('/u/Misty')
  await expect(page.locator('.challenge-card', { hasText: 'Charizard' })).toContainText('Not for trade')

  // My own card: locked from its detail
  await page.goto('/challenge/collection')
  await page.locator('.coll-card', { hasText: 'Charmander' }).click()
  await page.getByRole('button', { name: 'Keep out of trades' }).click()
  await expect(page.getByRole('button', { name: 'Not for trade' })).toHaveAttribute('aria-pressed', 'true')
  expect(backend.state.locks).toEqual(['sv3pt5-4'])
  await page.keyboard.press('Escape')
  await expect(page.locator('.coll-card', { hasText: 'Charmander' }).locator('.coll-lock')).toBeVisible()

  await page.goto('/challenge/trades?to=Misty')
  await expect(page.getByText('1 card kept out of trades')).toBeVisible()
  await expect(page.getByRole('group', { name: /You give/ }).getByRole('button', { name: /Charmander/ })).toBeDisabled()
  await expect(page.getByRole('group', { name: /You ask Misty for/ }).getByRole('button', { name: /Charizard/ })).toBeDisabled()

  await page.getByRole('button', { name: 'Allow trades for Charmander' }).click()
  await expect(page.getByRole('group', { name: /You give/ }).getByRole('button', { name: /Charmander/ })).toBeEnabled()
  expect(backend.state.locks).toEqual([])
})

test('trade offers can be turned off from the trades page', async ({ page }) => {
  const backend = await mockSupabase(page)
  await page.goto('/challenge/trades')
  const toggle = page.getByRole('switch', { name: /Accept trade offers/ })
  await expect(toggle).toBeChecked()
  await toggle.click()
  await expect(page.getByText('Nobody can send you an offer.', { exact: false })).toBeVisible()
  expect(backend.state.profile.accepts_trades).toBe(false)
})

test('answers to my offers show first, with a badge until they are seen', async ({ page }, info) => {
  const backend = await mockSupabase(page, {
    badge: { answers: 1 },
    trades: [received({ id: 8, direction: 'sent', status: 'accepted', unseen: true, resolved_at: new Date().toISOString() })],
  })
  await page.goto('/challenge')
  await expect(page.locator('.ch-waiting')).toContainText('1 answer to your offers')
  // The Trades link carries the badge: the mode strip's shortcut on phones, the nav on desktop
  const tradesLink = info.project.name === 'mobile' ? page.locator('.mode-strip-trades') : page.locator('.app-header-nav').getByRole('link', { name: /Trades/ })
  await expect(tradesLink).toContainText('1')

  await tradesLink.click()
  await expect(page).toHaveURL(/\/challenge\/trades$/)
  await expect(page.getByRole('heading', { name: /New answers to your offers/ })).toBeVisible()
  await expect(page.locator('.trade-answer')).toContainText('Misty accepted your offer')
  await expect.poll(() => backend.state.answersMarked).toBe(1)
  await expect(tradesLink.locator('.nav-badge, .tab-badge')).toHaveCount(0)
  // Still on screen for this visit, and not repeated in the history
  await expect(page.locator('.trade-answer')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Past trades' })).toHaveCount(0)
})

test('a card of my challenge collection can be offered in a trade from its detail', async ({ page }) => {
  await mockSupabase(page, { challengeCollection: [collectionEntry('sv3pt5-4', 2), collectionEntry('sv3pt5-7')] })
  await page.goto('/challenge/collection')
  await page.locator('.coll-card', { hasText: 'Charmander' }).click()
  await page.getByRole('link', { name: 'Offer in a trade' }).click()
  await expect(page).toHaveURL(/\/challenge\/trades\?give=sv3pt5-4/)
  await page.getByLabel('Trainer').fill('Misty')
  await page.getByRole('button', { name: 'Find' }).click()
  const give = page.getByRole('group', { name: /You give/ })
  await expect(give.getByText('1/5')).toBeVisible()
  await expect(give.getByRole('button', { name: /Charmander/ })).toHaveAttribute('aria-pressed', 'true')
})

test('an offer can be answered with a counter-offer', async ({ page }) => {
  const backend = await mockSupabase(page, {
    challengeCollection: [collectionEntry('sv3pt5-4', 2), collectionEntry('sv3pt5-7')],
    trades: [received()],
    badge: { trades: 1 },
  })
  await page.goto('/challenge/trades')
  await page.locator('.trade').filter({ hasText: 'Misty' }).getByRole('button', { name: 'Counter' }).click()

  // Their offer, sides swapped
  await expect(page.getByRole('heading', { name: 'Counter-offer to Misty' })).toBeVisible()
  const give = page.getByRole('group', { name: /You give/ })
  const ask = page.getByRole('group', { name: /You ask Misty for/ })
  await expect(give.getByRole('button', { name: /Charmander/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(ask.getByRole('button', { name: /Charizard/ })).toHaveAttribute('aria-pressed', 'true')
  await give.getByRole('button', { name: /Squirtle/ }).click()

  await page.getByRole('button', { name: 'Send the counter-offer to Misty' }).click()
  await expect(page.getByText('Counter-offer sent to Misty!')).toBeVisible()
  expect(JSON.parse(rpcCalls(backend, 'counter_trade')[0].body)).toEqual({
    p_trade_id: 7,
    p_offer: ['sv3pt5-4', 'sv3pt5-7'],
    p_request: ['base1-4'],
  })
  // Mine is waiting, theirs is over, and the composer is a new offer again
  const sent = page.locator('section', { has: page.getByRole('heading', { name: 'Waiting for an answer' }) })
  await expect(sent.getByText('Counter-offer')).toBeVisible()
  await expect(page.locator('.history-status')).toHaveText('Countered')
  await expect(page.getByRole('heading', { name: 'New offer' })).toBeVisible()
})

test('a counter-offer can be dropped for a new offer, and says so when the server lacks it', async ({ page }) => {
  await mockSupabase(page, { challengeCollection: [collectionEntry('sv3pt5-4')], trades: [received()], counterTrade: 'missing' })
  await page.goto('/challenge/trades')
  await page.getByRole('button', { name: 'Counter' }).click()
  await page.getByRole('button', { name: 'Make a new offer instead' }).click()
  await expect(page.getByRole('heading', { name: 'New offer' })).toBeVisible()
  await expect(page.getByLabel('Trainer')).toHaveValue('Misty')

  await page.getByRole('button', { name: 'Counter' }).click()
  await page.getByRole('button', { name: 'Send the counter-offer to Misty' }).click()
  await expect(page.getByRole('alert')).toContainText("Counter-offers aren't available yet")
  await expect(page.locator('.trade').filter({ hasText: 'Misty' }).getByRole('button', { name: 'Accept' })).toBeVisible()
})

test('big collections show 60 cards in the pickers, then more on demand', async ({ page }) => {
  const many = Array.from({ length: 130 }, (_, i) => ({
    ...collectionEntry('sv3pt5-1'),
    card_id: `x-${i}`,
    cards: { ...byId['sv3pt5-1'], id: `x-${i}`, name: `Card ${i}` },
  }))
  await mockSupabase(page, { challengeCollection: [collectionEntry('sv3pt5-4')], partners: { misty: many } })
  await page.goto('/challenge/trades?to=Misty')
  const ask = page.getByRole('group', { name: /You ask Misty for/ })
  await expect(ask.locator('.picker-card')).toHaveCount(60)
  await ask.getByRole('button', { name: 'Show more (70 left)' }).click()
  await expect(ask.locator('.picker-card')).toHaveCount(120)
  await ask.getByRole('button', { name: 'Show more (10 left)' }).click()
  await expect(ask.locator('.picker-card')).toHaveCount(130)
  await expect(ask.getByRole('button', { name: /Show more/ })).toHaveCount(0)
  // A new search starts over
  await ask.getByRole('searchbox').fill('Card 1')
  await expect(ask.locator('.picker-card')).toHaveCount(41) // 1, 10-19, 100-129
})

test('a missing challenge card says who has it in double, and leads to an offer', async ({ page }) => {
  await mockSupabase(page, {
    challengeCollection: [collectionEntry('sv3pt5-4', 2)],
    traders: { 'base1-4': [{ username: 'Misty', quantity: 3 }] },
  })
  await page.goto('/challenge/collection/set/base1')
  await page.getByRole('button', { name: /Charizard/ }).click()
  await page.getByRole('button', { name: 'Who has it in double?' }).click()
  await expect(page.getByText('Trainers who have it in double')).toBeVisible()
  await expect(page.locator('.detail-trader')).toContainText('x3')
  await page.getByRole('link', { name: 'Ask for it' }).click()
  await expect(page).toHaveURL(/\/challenge\/trades\?to=Misty&want=base1-4/)
  await expect(page.getByRole('group', { name: /You ask Misty for/ }).getByRole('button', { name: /Charizard/ })).toHaveAttribute('aria-pressed', 'true')
})

test('nobody with the card in double says so', async ({ page }) => {
  await mockSupabase(page, { challengeCollection: [collectionEntry('sv3pt5-4')] })
  await page.goto('/challenge/collection/set/base1')
  await page.getByRole('button', { name: /Charizard/ }).click()
  await page.getByRole('button', { name: 'Who has it in double?' }).click()
  await expect(page.getByText('Nobody has it in double right now.')).toBeVisible()
})

test('a new player is told to open challenge boosters first and gets trainers to pick from', async ({ page }) => {
  await mockSupabase(page, { challengeCollection: [] })
  await page.goto('/challenge/trades')
  await expect(page.locator('.composer-empty')).toContainText('Your challenge collection is empty')
  await expect(page.locator('.composer-empty').getByRole('link', { name: 'Open challenge boosters' })).toHaveAttribute('href', '/challenge/boosters')

  // Suggestions from the challenge board, never myself (Ash)
  const suggest = page.getByRole('list', { name: 'Or pick a player with a big collection:' })
  await expect(suggest.getByRole('button')).toHaveText(['Misty'])
  await suggest.getByRole('button', { name: 'Misty' }).click()
  await expect(page.getByRole('group', { name: /You ask Misty for/ })).toBeVisible()
  await expect(suggest).toHaveCount(0)
})
