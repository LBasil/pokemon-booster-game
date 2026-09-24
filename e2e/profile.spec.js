import { expect, test } from '@playwright/test'
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
