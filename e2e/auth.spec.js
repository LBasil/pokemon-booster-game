import { expect, test } from '@playwright/test'
import { mockSupabase } from './support/supabase.js'

test('logging in lands on the hub with the username', async ({ page }) => {
  const backend = await mockSupabase(page)
  await page.goto('/')
  await page.getByLabel('Email').fill('ash@example.com')
  await page.getByLabel('Password', { exact: true }).fill('pikachu123')
  await page.getByRole('button', { name: 'Log in', exact: true }).last().click()

  await expect(page).toHaveURL('/game')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Welcome back, Ash!')
  expect(backend.calls.some((c) => c.path === '/auth/v1/token')).toBe(true)
})
