import { exerciseCount, expect, signIn, test } from '../fixtures.js'

test('signs in and lands on Today with a full cycle', async ({ app }) => {
  await expect(app.getByText(/^Cycle 1$/)).toBeVisible()
  await expect(app.getByText(/\d+ left/)).toBeVisible()
  // Every exercise in the catalogue is a row, and every row is a control.
  await expect(app.getByRole('checkbox')).toHaveCount(exerciseCount())
})

test('no console errors on a normal load', async ({ page }) => {
  const errors = []
  page.on('console', (m) => {
    // The boot probe to /api/state before sign-in is a 401 by design; the
    // browser logs it whatever the app does with it.
    if (m.type() === 'error' && !/401 \(Unauthorized\)/.test(m.text())) errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(String(e)))
  await signIn(page)
  await page.getByRole('button', { name: 'History' }).click()
  await page.getByRole('button', { name: 'Settings' }).click()
  expect(errors).toEqual([])
})

test('every exercise row meets the 44px touch target', async ({ app }) => {
  const marks = app.getByRole('checkbox')
  for (let i = 0; i < (await marks.count()); i++) {
    const box = await marks.nth(i).boundingBox()
    expect.soft(box.width, `mark ${i} width`).toBeGreaterThanOrEqual(44)
    expect.soft(box.height, `mark ${i} height`).toBeGreaterThanOrEqual(44)
  }
})

test('nothing overflows the phone viewport horizontally', async ({ app }) => {
  for (const tab of ['Today', 'History', 'Settings']) {
    await app.getByRole('button', { name: tab }).click()
    const overflow = await app.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect.soft(overflow, `${tab} horizontal overflow`).toBeLessThanOrEqual(0)
  }
})
