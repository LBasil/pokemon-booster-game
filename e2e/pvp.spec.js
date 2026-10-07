import { expect, test } from '@playwright/test'
import { collectionEntry } from './support/data.js'
import { mockSupabase as mockBackend, signIn } from './support/supabase.js'

// PvP battles like Pokémon TCG Pocket (migration 0030, typed energy 0031). In
// the mock every challenge Pokémon is Fire, weak to Water: Ember (30, Fire)
// and Flamethrower (90, Fire Fire Colorless); my energy zone always brings
// Fire. The opponent: Oddish (Active) and Venusaur ex (Bench, 2 points),
// Grass, weak to Fire, 60 HP: Ember knocks either out (3 points = a win). The
// server's turn: draw, attach a Grass energy, Vine Whip (20).
test.beforeEach(async ({ page }) => {
  await signIn(page)
})

// PvP is open to its testers only (0028): these tests play as Bazouk
const mockSupabase = (page, options = {}) => mockBackend(page, { username: 'Bazouk', ...options })

// 10 names, 2 copies each: a full deck of 20
const POKEMON = ['sv3pt5-4', 'sv3pt5-7', 'sv3pt5-1', 'sv3pt5-25', 'sv3pt5-5', 'sv3pt5-8', 'sv3pt5-2', 'sv3pt5-150', 'sv3pt5-6', 'base1-4']
const challengeCollection = POKEMON.map((id) => collectionEntry(id, 2))
// A saved deck, in the order the mock deals it: Charmander, Charmander,
// Charmeleon, Squirtle, Bulbasaur in hand; Charmeleon drawn on turn 1
const DECK = ['sv3pt5-4', 'sv3pt5-4', 'sv3pt5-5', 'sv3pt5-7', 'sv3pt5-1', 'sv3pt5-5', 'sv3pt5-7', 'sv3pt5-1', 'sv3pt5-25', 'sv3pt5-25',
  'sv3pt5-8', 'sv3pt5-8', 'sv3pt5-2', 'sv3pt5-2', 'sv3pt5-150', 'sv3pt5-150', 'sv3pt5-6', 'sv3pt5-6', 'base1-4', 'base1-4']
const withDeck = { decks: { all: { attack: DECK } } }

const board = (page) => page.locator('.pvp-battle')
const hand = (page) => page.getByRole('list', { name: /My hand/ })

async function setUp(page) {
  await hand(page).getByRole('button', { name: 'Charmander' }).first().click()
  await hand(page).getByRole('button', { name: 'Squirtle' }).click()
  await page.getByRole('button', { name: 'Start the battle' }).click()
  await expect(page.locator('.pvp-log')).toContainText('You go first.')
}

// My Active is the second "Active:" button (theirs comes first); a second tap unselects it.
// On a phone the actions are in a sheet that opens on the tapped card (PC: always beside the mat)
async function attachToActive(page) {
  if (!(await page.getByRole('button', { name: /Attach the Fire energy/ }).isVisible())) await board(page).getByRole('button', { name: /^Active: / }).nth(1).click()
  await page.getByRole('button', { name: /Attach the Fire energy/ }).click()
}

async function attack(page, name) {
  const button = page.getByRole('button', { name })
  if (!(await button.isVisible())) await board(page).getByRole('button', { name: /^Active: / }).nth(1).click()
  await button.click()
}

// A card opened on a phone covers the mat (tap outside or Escape closes it, like Pocket's zoom)
async function closeSheet(page) {
  if (await page.locator('.pvp-sheet-backdrop').isVisible()) await page.keyboard.press('Escape')
}

test('PvP is listed with the mini-games, with its rules', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/challenge/games')
  const tile = page.locator('.game-tile').filter({ hasText: 'PvP battles' })
  await expect(tile).toContainText('10 battles left today')
  await tile.click()
  await expect(page).toHaveURL(/\/challenge\/games\/pvp$/)
  await expect(page.getByRole('heading', { level: 1, name: 'PvP battles' })).toBeVisible()
  await expect(page.locator('a[href="/challenge/games"]:visible').first()).toHaveClass(/active|router-link-active/)
  await expect(page.locator('.pvp-rules')).toContainText('20 cards from your challenge collection')
  await expect(page.locator('.pvp-rules')).toContainText('1 Supporter a turn')
  await expect(page.locator('.pvp-rules')).toContainText('Asleep and Paralyzed')
})

test('auto deck: 20 cards in lines, 2 of a name, saved', async ({ page }) => {
  const backend = await mockSupabase(page, { challengeCollection })
  await page.goto('/challenge/games/pvp')
  const attackDeck = page.getByRole('group', { name: 'Attack deck' })
  await attackDeck.getByRole('button', { name: 'Auto deck' }).click()
  await expect(page.locator('.pvp-count')).toHaveText('20 / 20')
  await expect(page.locator('.pvp-deck-cards > li')).toHaveCount(10)
  await expect(page.locator('.pvp-deck-cards > li').filter({ hasText: 'Charmeleon' })).toContainText('2×')
  // a full deck: the pool and the energy picker stay folded (user, 2026-10-06: every card showed)
  await expect(page.locator('.pvp-grid')).toHaveCount(0)
  await expect(page.locator('.pvp-energy-summary')).toContainText('Fire')
  await page.getByRole('button', { name: /Add or swap cards/ }).click()
  await expect(page.locator('.pvp-grid > li').first()).toBeVisible()
  await page.getByRole('button', { name: 'Save the deck' }).click()
  await expect(page.locator('.pvp-builder')).toHaveCount(0)
  await expect(attackDeck.locator('.pvp-deck-lines li')).toHaveCount(10)
  const saved = JSON.parse(backend.calls.find((call) => call.path === '/rest/v1/rpc/pvp_save_deck').body)
  expect(saved.p_cards).toHaveLength(20)
  expect(saved.p_role).toBe('attack')
  // every card is Fire: the auto deck runs on Fire energy
  expect(saved.p_energy).toEqual(['Fire'])
  await expect(attackDeck.locator('.pvp-deck-energy')).toContainText('Fire')
})

test('the builder: 2 copies at most, a Basic needed, lone evolutions flagged', async ({ page }) => {
  await mockSupabase(page, { challengeCollection })
  await page.goto('/challenge/games/pvp')
  await page.getByRole('group', { name: 'Attack deck' }).getByRole('button', { name: 'Build my deck' }).click()
  await page.getByRole('button', { name: 'Add Charmeleon' }).click()
  await expect(page.locator('.pvp-deck-list').getByRole('alert')).toContainText('Put in at least one Basic Pokémon')
  await expect(page.locator('.pvp-deck-list')).toContainText("Charmeleon can't evolve here")
  await page.getByRole('button', { name: 'Add Charmeleon' }).click()
  await expect(page.getByRole('button', { name: 'Add Charmeleon' })).toBeDisabled()
  await page.getByRole('button', { name: 'Add Charmander' }).click()
  await expect(page.locator('.pvp-deck-list')).not.toContainText("can't evolve")
  await expect(page.locator('.pvp-deck-list')).toContainText('17 cards to go')
  await expect(page.getByRole('button', { name: 'Save the deck' })).toBeDisabled()
  // The deck's energy: picked for my cards (Fire); on Water alone the Fire cards can't attack
  const energy = page.getByRole('group', { name: 'Deck energy' })
  await expect(energy.getByRole('button', { name: 'Fire' })).toHaveAttribute('aria-pressed', 'true')
  await energy.getByRole('button', { name: 'Water' }).click()
  await energy.getByRole('button', { name: 'Fire' }).click()
  await expect(page.locator('.pvp-deck-list')).toContainText("With Water energy, these can't attack: Charmeleon, Charmander")
  await expect(page.locator('.pvp-pick.is-off').first()).toContainText("Your energy can't pay its attacks")
  await energy.getByRole('button', { name: 'Water' }).click()
  await expect(energy.getByRole('alert')).toContainText('Pick at least one energy type')
  // Search and filters
  await page.getByPlaceholder('Search a card').fill('squir')
  await expect(page.locator('.pvp-grid > li')).toHaveCount(1)
})

test('a bot battle: set up, the server plays, attach, attack, knock out, win coins', async ({ page }) => {
  const backend = await mockSupabase(page, { challengeCollection, pvp: withDeck })
  await page.goto('/challenge/games/pvp')
  await page.getByRole('button', { name: /^Easy/ }).click()
  await expect(page.locator('.pvp-next')).toContainText('Put a Basic Pokémon in your Active spot')
  await expect(hand(page).getByRole('button')).toHaveCount(5)
  await setUp(page)
  await expect(page.locator('.pvp-turn-bar')).toContainText('No energy on the first turn')

  // My first turn: no attack yet
  await board(page).getByRole('button', { name: /^Active: Charmander/ }).click()
  await expect(page.getByRole('button', { name: /Ember/ })).toBeDisabled()
  await expect(page.getByRole('button', { name: /Ember/ })).toContainText('Not on the first turn')
  await closeSheet(page)
  await page.getByRole('button', { name: 'End my turn' }).click()
  await expect(page.locator('.pvp-log')).toContainText('Their Oddish uses Vine Whip: 20 damage.')
  await expect(page.locator('.pvp-log')).toContainText('Your turn.')

  // Turn 3: the zone's Fire energy on Charmander, Ember knocks Oddish out
  await expect(page.locator('.pvp-turn-bar')).toContainText('A Fire energy to attach this turn')
  await expect(page.locator('.pvp-chip').filter({ hasText: 'Energy' })).toBeVisible()
  await attachToActive(page)
  await expect(page.locator('.pvp-log')).toContainText('You attach a Fire energy to Charmander.')
  await expect(page.locator('.pvp-turn-bar')).toContainText('Energy attached this turn')
  await attack(page, /Ember/)
  await expect(page.locator('.pvp-log')).toContainText('Your Charmander uses Ember: 60 damage.')
  await expect(page.locator('.pvp-log')).toContainText('Oddish is knocked out: you take 1 point(s).')
  await expect(page.locator('.pvp-plate.is-mine')).toContainText('1 / 3')

  // Turn 5: Venusaur ex (2 points) falls too: a win
  await attachToActive(page)
  await attack(page, /Ember/)
  await expect(page.locator('.pvp-feedback')).toContainText('You win!')
  await expect(page.locator('.pvp-feedback')).toContainText('You earn')
  const acts = backend.calls.filter((call) => call.path === '/rest/v1/rpc/pvp_act').map((call) => JSON.parse(call.body).p_action.type)
  expect(acts).toEqual(['setup', 'end', 'attach', 'attack', 'attach', 'attack'])
  await page.getByRole('button', { name: 'Back to battles' }).click()
  await expect(page.locator('.pvp-history')).toContainText('You fought a bot (Easy)')
})

test('a Trainer: a Supporter, not on the first turn, once a turn (0032)', async ({ page }) => {
  // Giovanni's Charisma (the mock's Supporter: draw 2) is dealt second
  const deck = ['sv3pt5-4', 'sv3pt5-190', ...DECK.slice(1, 19)]
  await mockSupabase(page, { challengeCollection: [...challengeCollection, collectionEntry('sv3pt5-190', 2)], pvp: { decks: { all: { attack: deck } } } })
  await page.goto('/challenge/games/pvp')
  await expect(page.getByRole('group', { name: 'Attack deck' })).toContainText("Giovanni's Charisma")
  await page.getByRole('button', { name: /^Easy/ }).click()
  await hand(page).getByRole('button', { name: 'Charmander' }).first().click()
  await page.getByRole('button', { name: 'Start the battle' }).click()
  await hand(page).getByRole('button', { name: "Giovanni's Charisma" }).click()
  await expect(page.locator('.pvp-panel-actions')).toContainText('No Supporter on the first turn')
  await closeSheet(page)
  await page.getByRole('button', { name: 'End my turn' }).click()
  // "Your turn." is in the log since the first turn: wait for the bot's turn to be over
  await expect(page.locator('.pvp-log')).toContainText('Their Oddish uses Vine Whip')
  const before = await hand(page).getByRole('button').count()
  await hand(page).getByRole('button', { name: "Giovanni's Charisma" }).click()
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await expect(page.locator('.pvp-log')).toContainText("You play Giovanni's Charisma.")
  await expect(hand(page).getByRole('button')).toHaveCount(before + 1)
})

test('an ability: used from the board, once a turn (0033)', async ({ page }) => {
  // Mewtwo (the mock's ability: draw a card) is dealt first
  const deck = ['sv3pt5-150', ...DECK.filter((id) => id !== 'sv3pt5-150'), 'sv3pt5-150']
  await mockSupabase(page, { challengeCollection, pvp: { decks: { all: { attack: deck } } } })
  await page.goto('/challenge/games/pvp')
  await page.getByRole('button', { name: /^Easy/ }).click()
  await hand(page).getByRole('button', { name: 'Mewtwo' }).click()
  await page.getByRole('button', { name: 'Start the battle' }).click()
  await board(page).getByRole('button', { name: /^Active: Mewtwo/ }).click()
  const before = await hand(page).getByRole('button').count()
  await page.getByRole('button', { name: 'Use Psychic Draw' }).click()
  await expect(page.locator('.pvp-log')).toContainText('Your Mewtwo uses Psychic Draw.')
  await expect(hand(page).getByRole('button')).toHaveCount(before + 1)
  // Mewtwo stays picked: its ability now says why not
  await expect(page.locator('.pvp-abilities')).toContainText('Already used this turn')
})

test('evolve, bench and retreat, with the card details', async ({ page }) => {
  await mockSupabase(page, { challengeCollection, pvp: withDeck })
  await page.goto('/challenge/games/pvp')
  await page.getByRole('button', { name: /^Normal/ }).click()
  await setUp(page)
  // A Basic from the hand to the Bench
  await hand(page).getByRole('button', { name: 'Bulbasaur' }).click()
  await page.getByRole('button', { name: 'Put on the Bench' }).click()
  await expect(board(page).getByRole('list', { name: 'Bench' }).nth(1)).toContainText('Bulbasaur')
  // No evolving on the first turn
  await hand(page).getByRole('button', { name: 'Charmeleon' }).first().click()
  await expect(page.getByRole('button', { name: 'Evolve Charmander' })).toHaveCount(0)
  await closeSheet(page)
  await page.getByRole('button', { name: 'End my turn' }).click()
  await expect(page.locator('.pvp-log')).toContainText('Your turn.')
  // Turn 3: Charmander evolves into Charmeleon
  await hand(page).getByRole('button', { name: 'Charmeleon' }).first().click()
  await page.getByRole('button', { name: 'Evolve Charmander' }).click()
  await expect(page.locator('.pvp-log')).toContainText('Your Pokémon evolves into Charmeleon.')
  await expect(board(page).getByRole('button', { name: /^Active: Charmeleon/ })).toBeVisible()
  // Details: the attacks' texts
  await board(page).getByRole('button', { name: /^Active: Charmeleon/ }).click()
  await page.getByRole('button', { name: 'Card details' }).click()
  await expect(page.getByRole('dialog')).toContainText('Discard an Energy from this Pokémon.')
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click()
  // Retreat: an energy, then Squirtle comes in
  await attachToActive(page)
  await closeSheet(page)
  await board(page).getByRole('list', { name: 'Bench' }).nth(1).getByRole('button', { name: /^Squirtle/ }).click()
  await page.getByRole('button', { name: /^Retreat: Charmeleon goes to the Bench/ }).click()
  await expect(page.locator('.pvp-log')).toContainText('Squirtle is now your Active Pokémon.')
})

test('a player battle: against Misty, giving up asks first and loses Elo', async ({ page }) => {
  await mockSupabase(page, { challengeCollection, pvp: withDeck })
  await page.goto('/challenge/games/pvp')
  await page.getByRole('button', { name: 'Find an opponent' }).click()
  await expect(page.getByRole('heading', { name: 'Against Misty' })).toBeVisible()
  await setUp(page)
  await page.getByRole('button', { name: 'Battle menu' }).click()
  await page.getByRole('button', { name: 'Give up' }).click()
  await page.getByRole('button', { name: 'Sure? Give up (a loss)' }).click()
  await expect(page.locator('.pvp-feedback')).toContainText('You gave up.')
  await expect(page.locator('.pvp-feedback')).toContainText('Elo -16')
})

test('a battle in progress comes back after a reload', async ({ page }) => {
  await mockSupabase(page, { challengeCollection, pvp: withDeck })
  await page.goto('/challenge/games/pvp')
  await page.getByRole('button', { name: /^Hard/ }).click()
  await setUp(page)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Against a bot (Hard)' })).toBeVisible()
  await expect(board(page).getByRole('button', { name: /^Active: Charmander/ })).toBeVisible()
})

// Back through the app (no reload): the store still holds the battle and its
// log when the view sets up (live, 2026-10-06: "Cannot access ... before
// initialization", watch(logLines) ran before eventName was declared)
test('a battle in progress comes back from the mini-games page', async ({ page }) => {
  await mockSupabase(page, { challengeCollection, pvp: withDeck })
  await page.goto('/challenge/games/pvp')
  await page.getByRole('button', { name: /^Hard/ }).click()
  await setUp(page)
  await page.locator('a[href="/challenge/games"]:visible').first().click()
  await page.locator('.game-tile').filter({ hasText: 'PvP battles' }).click()
  await expect(board(page).getByRole('button', { name: /^Active: Charmander/ })).toBeVisible()
  await expect(page.locator('.pvp-log')).toContainText('You go first.')
})

test('formats: one era or one set, and no opponent says why', async ({ page }) => {
  await mockSupabase(page, { challengeCollection, pvp: { opponent: false, decks: { 'era:Scarlet & Violet': { attack: DECK.slice(0, 18).concat(['sv3pt5-6', 'sv3pt5-6']) } } } })
  await page.goto('/challenge/games/pvp')
  const kinds = page.getByRole('tablist', { name: 'Format' })
  await kinds.getByRole('tab', { name: 'One era' }).click()
  await expect(page.getByLabel('Era', { exact: true })).toHaveValue('era:Scarlet & Violet')
  await expect(page.getByLabel('Era', { exact: true }).locator('option')).toHaveText(['Base (2 cards)', 'Scarlet & Violet (18 cards)'])
  await kinds.getByRole('tab', { name: 'One set' }).click()
  await expect(page.getByLabel('Set', { exact: true })).toHaveValue('set:sv3pt5')
  await expect(page.getByRole('heading', { name: 'Ranking: 151' })).toBeVisible()
  // Remembered on this device
  await page.reload()
  await expect(page.getByLabel('Set', { exact: true })).toHaveValue('set:sv3pt5')
  await kinds.getByRole('tab', { name: 'Every card' }).click()
})

test('no opponent in a format says so', async ({ page }) => {
  await mockSupabase(page, { challengeCollection, pvp: { ...withDeck, opponent: false } })
  await page.goto('/challenge/games/pvp')
  await page.getByRole('button', { name: 'Find an opponent' }).click()
  await expect(page.getByRole('alert')).toContainText('No opponent in this format yet')
})

test('closed to everyone but the testers', async ({ page }) => {
  const backend = await mockBackend(page, { challengeCollection })
  await page.goto('/challenge/games/pvp')
  await expect(page.getByText('PvP battles are coming soon.')).toBeVisible()
  await page.goto('/challenge/games')
  await expect(page.locator('.game-tile').filter({ hasText: 'PvP battles' })).toContainText('Coming soon')
  expect(backend.calls.filter((call) => call.path.startsWith('/rest/v1/rpc/pvp_'))).toEqual([])
})

test('before the migrations, PvP says it is coming', async ({ page }) => {
  await mockSupabase(page, { pvp: 'missing' })
  await page.goto('/challenge/games/pvp')
  await expect(page.getByText('PvP battles are coming soon.')).toBeVisible()
  await page.goto('/challenge/games')
  await expect(page.locator('.game-tile').filter({ hasText: 'PvP battles' })).toContainText('Coming soon')
})

test('a server still on the 5-card battles (before 0030) says it is coming', async ({ page }) => {
  await mockSupabase(page, { pvp: { engine: undefined } })
  await page.goto('/challenge/games/pvp')
  await expect(page.getByText('PvP battles are coming soon.')).toBeVisible()
})

test('bots: past the paying battles, they play for fun', async ({ page }) => {
  await mockSupabase(page, { challengeCollection, pvp: { ...withDeck, botsToday: 5 } })
  await page.goto('/challenge/games/pvp')
  await expect(page.locator('.pvp-bots')).toContainText('No more coins today: 15 bot battles left for fun.')
  await expect(page.locator('.pvp-bot-reward')).toHaveCount(0)
})

test('the board and the builder never scroll sideways on the narrowest phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 })
  await mockSupabase(page, { challengeCollection, pvp: withDeck })
  await page.goto('/challenge/games/pvp')
  await page.getByRole('group', { name: 'Defense deck' }).getByRole('button', { name: 'Build my deck' }).click()
  await page.getByRole('button', { name: 'Add Charmander' }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.getByRole('button', { name: /^Easy/ }).click()
  await setUp(page)
  await board(page).getByRole('button', { name: /^Active: Charmander/ }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
})

test('a phone plays a turn on one screen, like Pocket: what to do, the energy dragged or tapped, the Active tapped to attack', async ({ page }, testInfo) => {
  // user, 2026-10-07 (screenshots of Pocket): the battle takes the whole screen,
  // one sentence says what to do, what can be played glows
  test.skip(testInfo.project.name !== 'mobile', 'the phone layout')
  await mockSupabase(page, { challengeCollection, pvp: withDeck })
  await page.goto('/challenge/games/pvp')
  await page.getByRole('button', { name: /^Easy/ }).click()
  await setUp(page)
  await page.getByRole('button', { name: 'End my turn' }).click()
  await expect(page.locator('.pvp-log')).toContainText('Your turn.')
  await expect(page.locator('.pvp-next')).toContainText("Attach this turn's energy")
  // no page around the mat: no tab bar, no scrolling, everything on one screen and uncovered
  await expect(page.locator('.app-tabbar')).toBeHidden()
  expect(await page.locator('.pvp-battle').boundingBox()).toEqual({ x: 0, y: 0, ...page.viewportSize() })
  const active = board(page).getByRole('button', { name: /^Active: Charmander/ })
  for (const part of [page.locator('.pvp-topbar'), page.locator('.pvp-energy-token'), page.getByRole('button', { name: 'End my turn' }), active, hand(page)]) {
    await expect(part).toBeInViewport({ ratio: 0.9 })
  }
  const box = await active.boundingBox()
  expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.pvp-side.is-mine'), [box.x + box.width / 2, box.y + box.height - 4])).toBe(true)
  // what can be played glows: the Basics and evolutions of my hand
  await expect(hand(page).locator('.pvp-hand-card.is-playable').first()).toBeVisible()
  // the energy tapped, then my Active
  await page.locator('.pvp-energy-token').click()
  await expect(page.locator('.pvp-next')).toContainText('Now tap the Pokémon that gets the energy.')
  await active.click()
  await expect(page.locator('.pvp-log')).toContainText('You attach a Fire energy to Charmander.')
  await expect(page.locator('.pvp-next')).toContainText('Tap your Active Pokémon to attack')
  await expect(active).toHaveClass(/is-playable/)
  // the Active opens big with its attacks: weak to Fire, Oddish takes double
  await active.click()
  await expect(page.getByRole('button', { name: /Ember/ })).toContainText('Super effective (×2)')
  await page.getByRole('button', { name: /Ember/ }).click()
  await expect(page.locator('.pvp-log')).toContainText('Your Charmander uses Ember: 60 damage.')
})

test('a laptop sees the whole battle on one screen: both sides, the log, the hand and the actions', async ({ page }, testInfo) => {
  // user, 2026-10-06: "sur PC ça manque de lisibilité, je scroll en boucle" (the battle was 1,860px tall)
  test.skip(testInfo.project.name !== 'desktop', 'the PC layout')
  await page.setViewportSize({ width: 1280, height: 720 })
  await mockSupabase(page, { challengeCollection, pvp: withDeck })
  await page.goto('/challenge/games/pvp')
  await page.getByRole('button', { name: /^Easy/ }).click()
  await setUp(page)
  await page.getByRole('button', { name: 'End my turn' }).click()
  await expect(page.locator('.pvp-log')).toContainText('Your turn.')
  await page.evaluate(() => document.querySelector('.pvp-battle').scrollIntoView({ block: 'start' }))
  for (const part of ['.pvp-topbar', '.pvp-side.is-theirs', '.pvp-log', '.pvp-side.is-mine', '.pvp-hand']) {
    await expect(page.locator(part)).toBeInViewport({ ratio: 0.95 })
  }
  await expect(page.getByRole('button', { name: 'Attach the Fire energy to Charmander' })).toBeInViewport()
  await expect(page.getByRole('button', { name: 'End my turn' })).toBeInViewport()
  // the log sits beside their side, the actions beside mine
  const [log, theirs, actions, mine] = await Promise.all(['.pvp-log', '.pvp-side.is-theirs', '.pvp-panel-actions', '.pvp-side.is-mine'].map((s) => page.locator(s).boundingBox()))
  expect(log.x).toBeGreaterThan(theirs.x + theirs.width)
  expect(actions.x).toBeGreaterThan(mine.x + mine.width)
})

// Drags with the mouse: down, a few moves, up (user, 2026-10-06: "compliqué de devoir tap partout")
async function dragOnto(page, from, to) {
  const a = await from.boundingBox()
  const b = await to.boundingBox()
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 - 30, { steps: 4 })
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 })
  await page.mouse.up()
}

test('drag and drop like Pocket: a Basic onto the Bench, the energy onto a Pokémon, or the energy tapped then a Pokémon', async ({ page }, testInfo) => {
  const backend = await mockSupabase(page, { challengeCollection, pvp: withDeck })
  await page.goto('/challenge/games/pvp')
  await page.getByRole('button', { name: /^Easy/ }).click()
  await setUp(page)
  // turn 1: Bulbasaur from my hand onto an empty Bench spot
  const myBench = board(page).getByRole('list', { name: 'Bench' }).nth(1)
  await dragOnto(page, hand(page).getByRole('button', { name: 'Bulbasaur' }), myBench.locator('.pvp-empty').first())
  await expect(myBench).toContainText('Bulbasaur')
  await expect(page.locator('.pvp-panel-actions')).not.toContainText('Put on the Bench') // nothing got picked
  await page.getByRole('button', { name: 'End my turn' }).click()
  await expect(page.locator('.pvp-log')).toContainText('Your turn.')
  // turn 3: the zone's energy dragged onto my Active (on a phone), tapped then the Pokémon (on a laptop)
  const active = board(page).getByRole('button', { name: /^Active: Charmander/ })
  if (testInfo.project.name === 'mobile') await dragOnto(page, page.locator('.pvp-energy-token'), active)
  else {
    await page.locator('.pvp-energy-token').click()
    await active.click()
  }
  await expect(page.locator('.pvp-log')).toContainText('You attach a Fire energy to Charmander.')
  // Ember knocks Oddish out (no number on the Pokémon that takes its place), Vine Whip hits back: 20 on Charmander
  await attack(page, /Ember/)
  await expect(board(page).getByRole('button', { name: /^Active: Charmander/ }).locator('.pvp-hit')).toHaveText('−20')
  await expect(board(page).getByRole('button', { name: /^Active: Venusaur/ }).locator('.pvp-hit')).toHaveCount(0)
  // turn 5: tap the energy, then Bulbasaur
  await page.locator('.pvp-energy-token').click()
  await myBench.getByRole('button', { name: /^Bulbasaur/ }).click()
  await expect(page.locator('.pvp-log')).toContainText('You attach a Fire energy to Bulbasaur.')
  const acts = backend.calls.filter((call) => call.path === '/rest/v1/rpc/pvp_act').map((call) => JSON.parse(call.body).p_action)
  expect(acts.map((a) => a.type)).toEqual(expect.arrayContaining(['bench', 'attach']))
  expect(acts.find((a) => a.type === 'attach')).toMatchObject({ pos: 0 })
})
