import { expect, test } from '../fixtures.js'

const mark = (app, name) => app.getByRole('checkbox', { name, exact: true })

/**
 * B5. The container runs UTC but "today" is the client's local day, so the
 * daily band has to clear itself at local midnight while the app sits open.
 * Playwright's clock API stands in for actually moving the machine's clock.
 */
test('B5 — the daily band clears at local midnight, the cycle does not', async ({ page }) => {
  const { resetState, signIn } = await import('../fixtures.js')
  resetState()

  const justBeforeMidnight = new Date()
  justBeforeMidnight.setHours(23, 55, 0, 0)
  await page.clock.install({ time: justBeforeMidnight })
  await signIn(page)

  const daily = page.getByRole('region', { name: 'Every day' })
  const dailyName = (await daily.locator('.daily-name').first().textContent()).trim()
  const cycleName = (await page.locator('.exercise-name').first().textContent()).trim()

  await mark(page, dailyName).click()
  await mark(page, cycleName).click()
  await expect(mark(page, dailyName)).toHaveAttribute('aria-checked', 'true')
  await expect(mark(page, cycleName)).toHaveAttribute('aria-checked', 'true')

  // Past midnight, with the 60s poll allowed to fire.
  await page.clock.fastForward('10:00')

  await expect(mark(page, dailyName)).toHaveAttribute('aria-checked', 'false')
  await expect(mark(page, cycleName)).toHaveAttribute('aria-checked', 'true')
})
