import { expect, psql, test } from '../fixtures.js'

const mark = (app, name) => app.getByRole('checkbox', { name, exact: true })
const openNames = async (app) =>
  (await app.locator('.exercise[data-done="false"] .exercise-name').allTextContents()).map((s) =>
    s.trim(),
  )
const outbox = (app) => app.evaluate(() => JSON.parse(localStorage.getItem('exse.outbox') ?? '[]'))
const logCount = () => psql('select count(*) from exercise_logs')

test('C1 — ticks made offline queue up and drain on reconnect', async ({ app, context }) => {
  // One per category, so no category completes and collapses its rows away.
  const names = []
  for (const cat of await app.locator('.category').all()) {
    if (names.length === 3) break
    names.push((await cat.locator('.exercise-name').first().textContent()).trim())
  }

  await context.setOffline(true)
  for (const n of names) await mark(app, n).click()

  // Instant local feedback, and the header says so.
  for (const n of names) await expect(mark(app, n)).toHaveAttribute('aria-checked', 'true')
  await expect(app.getByText('Not saved yet')).toBeVisible()
  await expect.poll(() => outbox(app).then((o) => o.length)).toBe(3)
  expect(await logCount()).toBe('0')

  await context.setOffline(false)
  await expect(app.getByText('Not saved yet')).toBeHidden({ timeout: 15000 })
  expect(await outbox(app)).toEqual([])
  expect(await logCount()).toBe('3')
})

test('C2 — a tick made mid-flight is not swallowed by the batch it missed', async ({
  app,
  context,
}) => {
  const [a, b] = await openNames(app)

  // Hold the first sync open, tick again while it is in flight, then release.
  let release
  const held = new Promise((r) => (release = r))
  let seen = 0
  await context.route('**/api/sync', async (route) => {
    if (++seen === 1) await held
    await route.continue()
  })

  await mark(app, a).click()
  await expect.poll(() => outbox(app).then((o) => o.length)).toBe(1)
  await app.waitForTimeout(2500) // let the debounced flush start
  await mark(app, b).click()
  release()

  await expect(app.getByText('Not saved yet')).toBeHidden({ timeout: 15000 })
  expect(await outbox(app)).toEqual([])
  expect(await logCount()).toBe('2')
  await context.unroute('**/api/sync')
})

test('C3 — a 401 shows login without destroying local state or the outbox', async ({
  app,
  context,
}) => {
  const name = (await openNames(app))[0]

  await context.clearCookies()
  await context.route('**/api/sync', (route) => route.fulfill({ status: 401, body: '{}' }))
  await mark(app, name).click()

  await expect(app.getByRole('button', { name: 'Sign in' })).toBeVisible({ timeout: 15000 })
  // The whole point: a 401 is not "you have no data".
  expect(await outbox(app)).toHaveLength(1)
  expect(await app.evaluate(() => localStorage.getItem('exse.state'))).not.toBeNull()

  await context.unroute('**/api/sync')
  await app.getByLabel('Password').fill(process.env.EXSE_PASSWORD ?? 'testpass123')
  await app.getByRole('button', { name: 'Sign in' }).click()

  await expect(app.getByRole('navigation')).toBeVisible()
  await expect.poll(logCount, { timeout: 15000 }).toBe('1')
  expect(await outbox(app)).toEqual([])
})
