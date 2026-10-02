import { expect, test } from '@playwright/test'
import { mockSupabase } from './support/supabase.js'

test.beforeEach(async ({ page }) => {
  await mockSupabase(page)
})

test('a newcomer lands on "Sign up", a device that had an account on "Log in"', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Open Pokémon packs and fill your binder')
  await expect(page.getByRole('tab', { name: 'Sign up' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByLabel('Email')).toBeVisible()

  await page.evaluate(() => localStorage.setItem('pb-has-account', '1'))
  await page.reload()
  await expect(page.getByRole('tab', { name: 'Log in' })).toHaveAttribute('aria-selected', 'true')
})

test('signing up needs a username (else the email would name the account)', async ({ page }) => {
  const backend = await mockSupabase(page)
  await page.goto('/')
  const name = page.getByLabel('Username')
  await expect(name).toHaveAttribute('required', '')
  await name.fill('A')
  await page.getByLabel('Email').fill('new@example.com')
  await page.getByLabel('Password', { exact: true }).fill('pikachu123')
  await page.evaluate(() => document.querySelector('form').noValidate = true)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('alert')).toContainText('At least 2 characters')
  expect(backend.calls.some((c) => c.path === '/auth/v1/signup')).toBe(false)

  await name.fill('RedTrainer')
  await page.getByRole('button', { name: 'Create account' }).click()
  const signup = backend.calls.find((c) => c.path === '/auth/v1/signup')
  expect(JSON.parse(signup.body).data.username).toBe('RedTrainer')
})

test('language and theme switches persist across reloads', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'FR', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Ouvre des boosters Pokémon et remplis ton classeur')

  const toggle = page.locator('.theme-toggle')
  const before = await page.evaluate(() => document.documentElement.dataset.bsTheme)
  await toggle.click()
  const after = await page.evaluate(() => document.documentElement.dataset.bsTheme)
  expect(after).not.toBe(before)

  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Ouvre des boosters Pokémon et remplis ton classeur')
  expect(await page.evaluate(() => document.documentElement.dataset.bsTheme)).toBe(after)
})

test('forgot password sends a reset email', async ({ page }) => {
  const backend = await mockSupabase(page)
  await page.goto('/')
  await page.getByRole('tab', { name: 'Log in' }).click()
  await page.getByRole('button', { name: 'Forgot password?' }).click()
  await page.getByLabel('Email').fill('ash@example.com')
  await page.getByRole('button', { name: 'Send the link' }).click()
  await expect(page.getByRole('status')).toContainText('reset link is on its way')
  expect(backend.calls.some((c) => c.path === '/auth/v1/recover')).toBe(true)
})

test('signed-out visitors are sent back to the landing page', async ({ page }) => {
  await page.goto('/collection')
  await expect(page).toHaveURL('/')
})
