import { DAY_THRESHOLD, expect, psql, rotationCount, test } from '../fixtures.js'

/**
 * The order is frozen between sorts, so rows no longer move under a click.
 * Locators are still pinned by name rather than position: ending a cycle
 * re-sorts, and so does the Re-sort control.
 */
// Exact, because "Push-ups" is a substring of "Wide push-ups", and the row
// itself is the checkbox -- tapping the name is what marks it.
const mark = (app, name) => app.getByRole('checkbox', { name, exact: true })
const row = mark

async function openNames(app) {
  return (await app.locator('.exercise[data-done="false"] .exercise-name').allTextContents())
    .map((s) => s.trim())
}

async function tickAllCycle(app) {
  for (;;) {
    const open = await openNames(app)
    if (open.length === 0) break
    await mark(app, open[0]).click()
  }
}

test('B1 — finishing a cycle offers the next one and records it in full', async ({ app }) => {
  const total = rotationCount()
  await tickAllCycle(app)

  await expect(app.getByText('all done')).toBeVisible()
  const start = app.getByRole('button', { name: 'Start cycle 2' })
  await expect(start).toBeVisible()
  await start.click()

  await expect(app.getByText(/^Cycle 2$/)).toBeVisible()
  await expect(app.getByText(`${total} left`)).toBeVisible()
  await expect(app.locator('.exercise[data-done="true"]')).toHaveCount(0)

  await app.getByRole('button', { name: 'History' }).click()
  await expect(app.getByText('Cycle 1')).toBeVisible()
  await expect(app.getByText(`${total}/${total}`).first()).toBeVisible()
  await expect(app.getByText(/ended early/)).toHaveCount(0)
})

test('B2 — ending early names the skipped work and carries it forward', async ({ app }) => {
  // Leave exactly three undone, whatever the catalogue's size.
  for (let i = rotationCount(); i > 3; i--) {
    const open = await openNames(app)
    await mark(app, open[0]).click()
  }

  const skipped = await openNames(app)
  expect(skipped).toHaveLength(3)

  await app.getByRole('button', { name: 'End cycle early' }).click()
  const sheet = app.getByRole('dialog')
  await expect(sheet).toContainText('End cycle early?')
  await expect(sheet).toContainText('will come back first next cycle')
  await expect(sheet).toContainText(skipped[0])
  await sheet.getByRole('button', { name: 'End cycle and start 2' }).click()

  await expect(app.getByText(/^Cycle 2$/)).toBeVisible()

  // Skipped work leads its own category -- note this is NOT the literal top of
  // the list, since each one leads wherever it lives. Two skips can share a
  // category, in which case they take the first two places between them.
  for (const name of skipped) {
    const cat = app.locator('.category').filter({ has: mark(app, name) })
    const rows = (await cat.locator('.exercise-name').allTextContents()).map((s) => s.trim())
    const debt = await cat.locator('.skip-badge').count()
    expect(rows.indexOf(name), `${name} did not lead its category`).toBeLessThan(debt)
  }

  // And the categories carrying debt float above the ones that do not: after a
  // new cycle opens every ratio is 0, so skip debt is the deciding rule.
  const cats = await app.locator('.category').all()
  const withDebt = []
  for (const [i, c] of cats.entries()) {
    if ((await c.locator('.skip-badge').count()) > 0) withDebt.push(i)
  }
  expect(withDebt.length).toBeGreaterThan(0)
  expect(withDebt, 'a debt-free category sorted above one carrying debt').toEqual(
    withDebt.map((_, i) => i),
  )

  await expect(app.locator('.skip-badge')).toHaveCount(3)
  await expect(app.locator('.skip-badge').first()).toHaveText('skipped once')

  // Skip them again without doing them: the badge counts up.
  await app.getByRole('button', { name: 'End cycle early' }).click()
  await app.getByRole('dialog').getByRole('button', { name: 'End cycle and start 3' }).click()
  await expect(app.getByText(/^Cycle 3$/)).toBeVisible()
  await expect(app.locator('.skip-badge').first()).toHaveText('skipped twice')

  // Complete one, and its badge is cleared in the cycle after.
  const redeemed = skipped[0]
  await mark(app, redeemed).click()
  await app.getByRole('button', { name: 'End cycle early' }).click()
  await app.getByRole('dialog').getByRole('button', { name: 'End cycle and start 4' }).click()
  await expect(app.getByText(/^Cycle 4$/)).toBeVisible()
  await expect(row(app, redeemed).locator('.skip-badge')).toHaveCount(0)
})

test('B3 — a repeat later in the cycle logs the day without unticking', async ({ app }) => {
  const total = rotationCount()
  const names = await openNames(app)
  const name = names[0]
  await mark(app, name).click()
  await expect(app.getByText(`${total - 1} left`)).toBeVisible()

  // Pretend it was completed earlier in this cycle, and today is otherwise clean.
  psql(`update exercises set completed_on = current_date - 3 where name = '${name}'`)
  psql('delete from exercise_logs; delete from active_days;')
  await app.reload()

  await expect(mark(app, name)).toHaveAttribute('aria-checked', 'true')
  await mark(app, name).click()

  // Still done, and the count has not moved: the tap logged a repeat rather
  // than retracting the completion.
  await expect(mark(app, name)).toHaveAttribute('aria-checked', 'true')
  await expect(app.getByText(`${total - 1} left`)).toBeVisible()
  await expect
    .poll(() => psql('select count(*) from exercise_logs where day = current_date'))
    .toBe('1')
})

test('B4 — a day is earned by the threshold, and retracted below it', async ({ app }) => {
  const names = await openNames(app)
  const activeToday = () => psql('select count(*) from active_days where day = current_date')

  // One exercise is not a workout. Nor are two, or three.
  for (let i = 0; i < DAY_THRESHOLD - 1; i++) {
    await mark(app, names[i]).click()
    await expect.poll(activeToday).toBe('0')
  }

  await mark(app, names[DAY_THRESHOLD - 1]).click()
  await expect.poll(activeToday).toBe('1')

  // And dropping back below it takes the day with it.
  await mark(app, names[0]).click()
  await expect.poll(activeToday).toBe('0')
})

test('B7 — the daily band never earns a day on its own', async ({ app }) => {
  const dailies = (await app.locator('.daily-name').allTextContents()).map((s) => s.trim())
  expect(dailies.length, 'need more dailies than the threshold').toBeGreaterThan(DAY_THRESHOLD)

  for (const n of dailies) await mark(app, n).click()
  await expect
    .poll(() => psql('select count(*) from exercise_logs where day = current_date'))
    .toBe(String(dailies.length))
  expect(psql('select count(*) from active_days where day = current_date')).toBe('0')
})

test('B8 — a day can be marked and unmarked by hand from the calendar', async ({ app }) => {
  const activeToday = () => psql('select count(*) from active_days where day = current_date')
  await app.getByRole('button', { name: 'History' }).click()

  const today = app.locator('.day[data-today="true"]')
  await expect(today).toHaveAttribute('aria-pressed', 'false')
  await today.click()
  await expect(today).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(activeToday).toBe('1')

  await today.click()
  await expect(today).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(activeToday).toBe('0')
})

test('A6 — a completed category collapses to one line and reopens, after a re-sort', async ({
  app,
}) => {
  const cat = app.locator('.category').first()
  const heading = (await cat.locator('.category-head span').first().textContent()).trim()
  const names = (await cat.locator('.exercise-name').allTextContents()).map((s) => s.trim())

  for (const n of names) await mark(app, n).click()

  // It reads as done in place first -- collapsing it out from under the thumb
  // is exactly what the frozen order exists to prevent.
  await expect(app.locator('.completed-zone')).toHaveCount(0)
  await app.getByRole('button', { name: 'Re-sort' }).click()

  const collapsed = app.locator('.completed-zone .category-collapsed')
  await expect(collapsed).toHaveCount(1)
  await expect(collapsed).toContainText(heading)
  await expect(collapsed).toContainText(`${names.length}/${names.length}`)
  await expect(collapsed).toHaveAttribute('aria-expanded', 'false')

  await collapsed.click()
  await expect(app.locator('.completed-zone .exercise')).toHaveCount(names.length)
})
