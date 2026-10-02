import { expect, test } from '@playwright/test'
import { USER } from './support/data.js'
import { makeSession, mockSupabase } from './support/supabase.js'

test('logging in lands on the hub with the username', async ({ page }) => {
  const backend = await mockSupabase(page)
  await page.goto('/')
  await page.getByRole('tab', { name: 'Log in' }).click()
  await page.getByLabel('Email').fill('ash@example.com')
  await page.getByLabel('Password', { exact: true }).fill('pikachu123')
  await page.getByRole('button', { name: 'Log in', exact: true }).last().click()

  await expect(page).toHaveURL('/game')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Hi Ash')
  expect(backend.calls.some((c) => c.path === '/auth/v1/token')).toBe(true)
})

test('while the profile loads, the hub never shows the start of the email', async ({ page }) => {
  // An account with no sign-up username in its metadata, and a slow profile
  const user = { ...USER, email: 'jean.dupont@example.com', user_metadata: {} }
  await page.addInitScript(([key, session]) => localStorage.setItem(key, session), ['sb-e2e-auth-token', JSON.stringify(makeSession(user))])
  await mockSupabase(page)
  let release
  const gate = new Promise((resolve) => (release = resolve))
  await page.route(/\/rest\/v1\/profiles\?/, async (route) => {
    await gate
    await route.fallback()
  })
  await page.goto('/game')
  await expect(page.locator('.hub-title .name-skeleton')).toBeVisible()
  await expect(page.locator('body')).not.toContainText('jean.dupont')
  release()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Hi Ash')
  await expect(page.locator('body')).not.toContainText('jean.dupont')
})
