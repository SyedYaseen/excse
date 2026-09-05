import { expect, psql, test } from '../fixtures.js'

// Does not use the `app` fixture: signup creates its own account rather than
// signing in as the shared admin, and the row it leaves behind is cleaned up
// by email at the end rather than by resetState().
test('B9 — signing up creates a fresh, seeded, isolated account', async ({ page }) => {
  const email = `test-signup-${Date.now()}@example.com`
  try {
    await page.goto('/')
    await page.getByRole('button', { name: "Don't have an account? Sign up" }).click()
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill('a-fresh-password')
    await page.getByRole('button', { name: 'Sign up' }).click()
    await expect(page.getByRole('navigation')).toBeVisible()

    // A seeded catalogue of its own, not admin's -- and nothing ticked yet.
    await expect(page.getByRole('checkbox').first()).toBeVisible()
    await expect(page.getByText(/^Cycle 1$/)).toBeVisible()

    expect(psql(`select username, detailed_entry from users where username = '${email}'`)).toBe(
      `${email}|f`,
    )
  } finally {
    psql(`delete from users where username = '${email}'`)
  }
})

test('B9 — a duplicate email is rejected, case-insensitively', async ({ page, request }) => {
  const email = `test-dup-${Date.now()}@example.com`
  try {
    const first = await request.post('/api/signup', {
      data: { email, password: 'a-fresh-password' },
    })
    expect(first.ok()).toBe(true)

    await page.goto('/')
    await page.getByRole('button', { name: "Don't have an account? Sign up" }).click()
    await page.getByLabel('Email').fill(email.toUpperCase())
    await page.getByLabel('Password').fill('another-password')
    await page.getByRole('button', { name: 'Sign up' }).click()
    await expect(page.getByText(/already registered/i)).toBeVisible()
  } finally {
    psql(`delete from users where username = '${email}'`)
  }
})
