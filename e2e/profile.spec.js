import { expect, test } from '@playwright/test'
import { collectionEntry } from './support/data.js'
import { mockSupabase, signIn } from './support/supabase.js'

test('renaming: taken usernames are refused, free ones saved', async ({ page }) => {
  await signIn(page)
  await mockSupabase(page, { takenUsernames: ['Brock'] })
  await page.goto('/profile')
  await expect(page.locator('.trainer-name')).toHaveText('Ash')

  await page.getByRole('button', { name: 'Edit username' }).click()
  await page.locator('#username-input').fill('brock')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('alert')).toContainText('already taken')

  await page.locator('#username-input').fill('  Sacha  ')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.trainer-name')).toHaveText('Sacha')
})

test('the profile can be made private', async ({ page }) => {
  await signIn(page)
  const backend = await mockSupabase(page)
  await page.goto('/profile')
  const toggle = page.getByRole('switch', { name: /Show my profile to others/ })
  await expect(toggle).toBeChecked()
  await toggle.uncheck()
  await expect(toggle).not.toBeChecked()
  expect(backend.state.profile.is_public).toBe(false)
})

test('public profiles are readable signed out', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/u/misty')
  await expect(page.locator('.trainer-name')).toHaveText('Misty')
  await expect(page.getByRole('link', { name: 'Create my account' })).toBeVisible()
  await expect(page.getByText('Best cards')).toBeVisible()
})

test('unknown or private profiles say so', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/u/nobody')
  await expect(page.getByRole('heading', { name: 'Trainer not found' })).toBeVisible()
})

test("a public profile's numbers follow the game mode, challenge first", async ({ page }) => {
  await mockSupabase(page, {
    // Mostly played in the challenge: 3 cards there, none in unlimited
    partners: { misty: [{ ...collectionEntry('sv3pt5-199'), quantity: 3 }] },
  })
  await page.route('**/rest/v1/rpc/public_collection', (route) => route.fulfill({ json: [] }))
  await page.goto('/u/misty')
  const stat = (label) => page.locator('.stat').filter({ hasText: label }).locator('dd')
  await expect(page.getByRole('tab', { name: 'Challenge' })).toHaveAttribute('aria-selected', 'true')
  await expect(stat('Boosters opened')).toHaveText('4') // the server's count of challenge packs
  await expect(stat('Cards pulled')).toHaveText('3')
  await expect(page.locator('.rank-progress-count')).toContainText('Challenge')

  await page.getByRole('tab', { name: 'Unlimited' }).click()
  await expect(stat('Cards pulled')).toHaveText('0')
})

test('someone who only played unlimited opens on their unlimited numbers', async ({ page }) => {
  await mockSupabase(page, { partners: {} })
  await page.goto('/u/misty')
  await expect(page.getByRole('tab', { name: 'Unlimited' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.stat').filter({ hasText: 'Cards pulled' }).locator('dd')).toHaveText('2')
})

test('players who joined during the beta wear the beta tester badge', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/u/misty')
  await expect(page.locator('.trainer-card .beta-badge')).toContainText('Beta tester')
})
