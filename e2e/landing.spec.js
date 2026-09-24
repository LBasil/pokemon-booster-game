import { expect, test } from '@playwright/test'
import { mockSupabase } from './support/supabase.js'

test.beforeEach(async ({ page }) => {
  await mockSupabase(page)
})

test('landing shows the pitch and the log-in panel', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Rip open boosters.')
  await expect(page.getByRole('tab', { name: 'Log in' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByLabel('Email')).toBeVisible()
})

test('language and theme switches persist across reloads', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'FR', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Déchire des boosters.')

  const toggle = page.locator('.theme-toggle')
  const before = await page.evaluate(() => document.documentElement.dataset.bsTheme)
  await toggle.click()
  const after = await page.evaluate(() => document.documentElement.dataset.bsTheme)
  expect(after).not.toBe(before)

  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Déchire des boosters.')
  expect(await page.evaluate(() => document.documentElement.dataset.bsTheme)).toBe(after)
})

test('forgot password sends a reset email', async ({ page }) => {
  const backend = await mockSupabase(page)
  await page.goto('/')
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
