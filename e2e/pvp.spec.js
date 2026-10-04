import { expect, test } from '@playwright/test'
import { collectionEntry } from './support/data.js'
import { mockSupabase, signIn } from './support/supabase.js'

// PvP battles (migrations 0024 + 0025 + 0026: attack and defense decks). In the mock every challenge Pokémon is Fire
// with 60 HP: Ember (30, 1 energy) and Flamethrower (90, 3 energies).
// Misty's deck is PVP_OPPONENT_DECK: Grass cards weak to Fire (Ember knocks
// one out) using Vine Whip (20); Oddish first (1 prize), then Venusaur ex (2).
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
  const attackDeck = page.getByRole('group', { name: 'Attack deck' })
  const defenseDeck = page.getByRole('group', { name: 'Defense deck' })
  await expect(attackDeck).toContainText('You have 6 cards that can fight here')
  await expect(page.getByRole('button', { name: 'Find an opponent' })).toBeDisabled()

  await attackDeck.getByRole('button', { name: 'Build my deck' }).click()
  await expect(page.locator('.pvp-builder')).toContainText('Attack deck: pick 5 cards')
  const picks = page.locator('.pvp-pick')
  await expect(picks).toHaveCount(6) // the Trainer can't fight
  await expect(page.getByRole('button', { name: 'Save the deck' })).toBeDisabled()
  for (const name of ['Charmander', 'Squirtle', 'Bulbasaur', 'Pikachu', 'Charmeleon']) {
    await picks.filter({ hasText: name }).click()
  }
  await expect(page.locator('.pvp-count')).toHaveText('5 / 5')
  await expect(picks.filter({ hasText: 'Mewtwo' })).toBeDisabled()
  await page.getByRole('button', { name: 'Save the deck' }).click()
  await expect(attackDeck.locator('.pvp-row > li')).toHaveCount(5)
  const saved = backend.calls.find((call) => call.path === '/rest/v1/rpc/pvp_save_deck')
  expect(JSON.parse(saved.body)).toEqual({ p_format: 'all', p_cards: FIVE, p_role: 'attack' })
  // No defense deck yet: the attack deck defends
  await expect(defenseDeck).toContainText('your attack deck defends you meanwhile')

  // The battle: their deck is hidden
  await page.getByRole('button', { name: 'Find an opponent' }).click()
  await expect(page.getByRole('heading', { name: /Against Misty/ })).toBeVisible()
  await expect(page.locator('.pvp-theirs .is-hidden')).toHaveCount(5)

  const mine = page.locator('.pvp-play')
  const panel = page.locator('.pvp-attack-panel')
  const myEnergy = page.getByRole('meter', { name: 'My energy' })
  await expect(page.locator('.pvp-hint')).toHaveText('Pick one of your cards, then its attack.')
  await expect(myEnergy).toHaveAttribute('aria-valuenow', '1')

  // A card, then an attack I can pay for (Flamethrower needs 3 energies)
  await mine.nth(0).click()
  await expect(panel).toContainText('Charmander: pick an attack')
  await expect(panel.getByRole('button', { name: /Flamethrower/ })).toBeDisabled()
  await panel.getByRole('button', { name: /Ember/ }).click()
  await expect(page.locator('.pvp-feedback')).toContainText('Your Charmander used Ember: 60 damage to Oddish.')
  await expect(page.locator('.pvp-feedback')).toContainText('Oddish used Vine Whip: 20 damage.')
  await expect(page.locator('.pvp-feedback')).toContainText('Oddish is knocked out!')
  await expect(page.locator('.pvp-theirs .is-hidden')).toHaveCount(4)
  await expect(page.locator('.pvp-theirs')).toContainText('Oddish')
  await expect(page.locator('.pvp-score')).toContainText('1 / 3')
  const sent = backend.calls.filter((call) => call.path === '/rest/v1/rpc/pvp_play').at(-1)
  expect(JSON.parse(sent.body)).toEqual({ p_slot: 0, p_attack: 0 })

  // No attack: the energy is saved (the card stays picked)
  await panel.getByRole('button', { name: 'No attack (save energy)' }).click()
  await expect(page.locator('.pvp-feedback')).toContainText('Your Charmander didn’t attack (energy saved).'.replace('’', "'"))
  await expect(myEnergy).toHaveAttribute('aria-valuenow', '2')

  // Venusaur ex gives 2 prizes: 1 + 2 = 3, a win
  await mine.nth(1).click()
  await expect(panel).toContainText('Squirtle: pick an attack')
  await panel.getByRole('button', { name: /Ember/ }).click()

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
  await page.getByRole('group', { name: 'Attack deck' }).getByRole('button', { name: 'Build my deck' }).click()
  for (const name of ['Charmander', 'Squirtle', 'Bulbasaur', 'Pikachu', 'Charmeleon']) await page.locator('.pvp-pick').filter({ hasText: name }).click()
  await page.getByRole('button', { name: 'Save the deck' }).click()
  await page.getByRole('button', { name: 'Find an opponent' }).click()
  await page.locator('.pvp-play').first().click()
  await page.locator('.pvp-attack-panel').getByRole('button', { name: /Ember/ }).click()
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

test('auto deck: a defense deck picked for me, saved apart from the attack deck', async ({ page }) => {
  const backend = await mockSupabase(page, { challengeCollection })
  await page.goto('/challenge/games/pvp')
  const defenseDeck = page.getByRole('group', { name: 'Defense deck' })
  await defenseDeck.getByRole('button', { name: 'Auto deck' }).click()
  // The builder opens with 5 cards picked, nothing saved yet
  await expect(page.locator('.pvp-builder')).toContainText('Defense deck: pick 5 cards')
  await expect(page.locator('.pvp-count')).toHaveText('5 / 5')
  await expect(page.locator('.pvp-pick.is-picked')).toHaveCount(5)
  expect(backend.calls.some((call) => call.path === '/rest/v1/rpc/pvp_save_deck')).toBe(false)
  // Changed by hand, then "Auto deck" again fills it back
  await page.locator('.pvp-pick.is-picked').first().click()
  await expect(page.locator('.pvp-count')).toHaveText('4 / 5')
  await page.locator('.pvp-builder').getByRole('button', { name: 'Auto deck' }).click()
  await expect(page.locator('.pvp-count')).toHaveText('5 / 5')
  await page.getByRole('button', { name: 'Save the deck' }).click()

  await expect(defenseDeck.locator('.pvp-row > li')).toHaveCount(5)
  await expect(defenseDeck).toContainText('Other players attack this deck')
  const saved = JSON.parse(backend.calls.find((call) => call.path === '/rest/v1/rpc/pvp_save_deck').body)
  expect(saved.p_role).toBe('defense')
  expect(new Set(saved.p_cards).size).toBe(5)
  // A defense deck alone can't attack
  await expect(page.getByRole('button', { name: 'Find an opponent' })).toBeDisabled()
  await expect(page.getByRole('group', { name: 'Attack deck' })).toContainText('No deck in this format yet')
})

test('before 0026: one deck for both, a defense deck says it is not there yet', async ({ page }) => {
  const backend = await mockSupabase(page, { challengeCollection, pvp: { noRoles: true } })
  await page.goto('/challenge/games/pvp')
  await page.getByRole('group', { name: 'Attack deck' }).getByRole('button', { name: 'Auto deck' }).click()
  await page.getByRole('button', { name: 'Save the deck' }).click()
  await expect(page.getByRole('group', { name: 'Attack deck' }).locator('.pvp-row > li')).toHaveCount(5)
  const saves = backend.calls.filter((call) => call.path === '/rest/v1/rpc/pvp_save_deck').map((call) => JSON.parse(call.body))
  expect(saves.at(-1)).not.toHaveProperty('p_role')
  await expect(page.getByRole('button', { name: 'Find an opponent' })).toBeEnabled()

  await page.getByRole('group', { name: 'Defense deck' }).getByRole('button', { name: 'Auto deck' }).click()
  await page.getByRole('button', { name: 'Save the deck' }).click()
  await expect(page.getByRole('alert')).toContainText("Defense decks aren't available yet")
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
