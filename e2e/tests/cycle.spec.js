import { expect, psql, test } from '../fixtures.js'

/**
 * Ticking re-sorts the list immediately (done items sink, categories reorder),
 * so nothing here may hold a positional locator across a click. Everything is
 * pinned by exercise name.
 */
// Exact, because "Push-ups" is a substring of "Wide push-ups".
const mark = (app, name) => app.getByRole('checkbox', { name, exact: true })
const row = (app, name) =>
  app.locator('.exercise').filter({ has: app.getByRole('checkbox', { name, exact: true }) })

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

test('B1 — finishing a cycle offers the next one and records 16/16', async ({ app }) => {
  await tickAllCycle(app)

  await expect(app.getByText('all done')).toBeVisible()
  const start = app.getByRole('button', { name: 'Start cycle 2' })
  await expect(start).toBeVisible()
  await start.click()

  await expect(app.getByText(/^Cycle 2$/)).toBeVisible()
  await expect(app.getByText('16 left')).toBeVisible()
  await expect(app.locator('.exercise[data-done="true"]')).toHaveCount(0)

  await app.getByRole('button', { name: 'History' }).click()
  await expect(app.getByText('Cycle 1')).toBeVisible()
  await expect(app.getByText('16/16')).toBeVisible()
  await expect(app.getByText(/ended early/)).toHaveCount(0)
})

test('B2 — ending early names the skipped work and carries it forward', async ({ app }) => {
  for (let i = 0; i < 13; i++) {
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

  // Each skipped exercise leads its own category, and the categories carrying
  // skip debt float above the rest. Note this is NOT the literal top of the
  // list: with three skips in three categories they land at 1, 4 and 7.
  for (const name of skipped) {
    const cat = app.locator('.category').filter({
      has: app.getByRole('checkbox', { name, exact: true }),
    })
    await expect(cat.locator('.exercise-name').first()).toHaveText(name)
  }
  const leaders = await Promise.all(
    (await app.locator('.category').all())
      .slice(0, skipped.length)
      .map(async (c) => (await c.locator('.exercise-name').first().textContent()).trim()),
  )
  expect(leaders.sort()).toEqual([...skipped].sort())

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
  const name = (await openNames(app))[0]
  await mark(app, name).click()
  await expect(app.getByText('15 left')).toBeVisible()

  // Pretend it was completed earlier in this cycle, and today is otherwise clean.
  psql(`update exercises set completed_on = current_date - 3 where name = '${name}'`)
  psql('delete from exercise_logs; delete from active_days;')
  await app.reload()

  await expect(mark(app, name)).toHaveAttribute('aria-checked', 'true')
  await mark(app, name).click()

  // Still done, count unchanged -- and today now counts as exercised.
  await expect(mark(app, name)).toHaveAttribute('aria-checked', 'true')
  await expect(app.getByText('15 left')).toBeVisible()
  await expect
    .poll(() => psql('select count(*) from active_days where day = current_date'))
    .toBe('1')
})

test('B4 — untick retracts the day only when nothing else was done', async ({ app }) => {
  const [a, b] = await openNames(app)
  const activeToday = () => psql('select count(*) from active_days where day = current_date')

  await mark(app, a).click()
  await expect.poll(activeToday).toBe('1')
  await mark(app, a).click()
  await expect.poll(activeToday).toBe('0')

  await mark(app, a).click()
  await mark(app, b).click()
  await expect.poll(activeToday).toBe('1')
  await mark(app, a).click()
  await expect.poll(activeToday).toBe('1') // b still holds the day open
})

test('A6 — a completed category collapses to one line and reopens', async ({ app }) => {
  const cat = app.locator('.category').first()
  const heading = (await cat.locator('.category-head span').first().textContent()).trim()
  const names = (await cat.locator('.exercise-name').allTextContents()).map((s) => s.trim())

  for (const n of names) await mark(app, n).click()

  const collapsed = app.locator('.completed-zone .category-collapsed')
  await expect(collapsed).toHaveCount(1)
  await expect(collapsed).toContainText(heading)
  await expect(collapsed).toContainText(`${names.length}/${names.length}`)
  await expect(collapsed).toHaveAttribute('aria-expanded', 'false')

  await collapsed.click()
  await expect(app.locator('.completed-zone .exercise')).toHaveCount(names.length)
})
