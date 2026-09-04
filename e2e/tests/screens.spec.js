import { expect, psql, resetState, signIn, test } from '../fixtures.js'

/**
 * Not assertions -- this writes the images a human (or a model) reviews
 * against docs/DESIGN.md. Run with:
 *   npx playwright test screens
 * and look in e2e/screens/.
 */
const mark = (page, name) => page.getByRole('checkbox', { name, exact: true })

test.describe('screens', () => {
  test('captures every screen with realistic history', async ({ page }, testInfo) => {
    const theme = testInfo.project.name
    const shot = (name) =>
      page.screenshot({ path: `screens/${theme}-${name}.png`, fullPage: true })

    // ~120 scattered days, so the year view is worth looking at.
    resetState(`
      insert into active_days (user_id, day)
      select u.id, d::date
      from users u, generate_series(current_date - 200, current_date, interval '1 day') d
      where u.username = 'admin' and random() < 0.6
      on conflict do nothing;
    `)

    await signIn(page)
    await shot('1-today-empty')

    // Part-way through a cycle: one category done and collapsed, a daily ticked.
    const cat = page.locator('.category').first()
    for (const n of await cat.locator('.exercise-name').allTextContents()) {
      await mark(page, n.trim()).click()
    }
    const daily = page.getByRole('region', { name: 'Every day' })
    await mark(page, (await daily.locator('.daily-name').first().textContent()).trim()).click()
    await shot('2-today-partial')

    await page.getByRole('button', { name: 'History' }).click()
    await expect(page.getByText('day streak')).toBeVisible()
    await shot('3-history')

    await page.getByRole('button', { name: 'Settings' }).click()
    await shot('4-settings')

    // The confirm sheet -- the app's one modal.
    await page.getByRole('button', { name: 'Today' }).click()
    await page.getByRole('button', { name: 'End cycle early' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await shot('5-end-early-sheet')
    await page.getByRole('button', { name: 'Keep going' }).click()

    // And the completed state, where the primary action appears.
    for (;;) {
      const open = await page
        .locator('.exercise[data-done="false"] .exercise-name')
        .allTextContents()
      if (open.length === 0) break
      await mark(page, open[0].trim()).click()
    }
    await expect(page.getByRole('button', { name: 'Start cycle 2' })).toBeVisible()
    await shot('6-today-complete')

    // Signed out.
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
    await shot('7-login')
  })
})
