import { expect, psql, test } from '../fixtures.js'

const mark = (app, name) => app.getByRole('checkbox', { name, exact: true })
const settings = (app) => app.getByRole('button', { name: 'Settings' }).click()

test('B6 — add an exercise, and it appears in its category on Today', async ({ app }) => {
  await settings(app)
  await app.getByRole('button', { name: 'Add' }).click()
  await app.getByLabel('Name').fill('Test wall sit')
  await app.getByLabel('Muscle group').fill('Legs')
  await app.getByRole('button', { name: 'Save' }).click()

  await app.getByRole('button', { name: 'Today' }).click()
  await expect(app.getByText('17 left')).toBeVisible()
  await expect(mark(app, 'Test wall sit')).toBeVisible()

  await expect
    .poll(() => psql("select count(*) from exercises where name = 'Test wall sit'"))
    .toBe('1')
})

test('B6 — switching cadence to daily moves it into the top band', async ({ app }) => {
  psql(
    `insert into exercises (user_id, name, category, cadence)
     select id, 'Test bridge hold', 'Core', 'cycle' from users
     on conflict do nothing`,
  )
  await app.reload()

  await settings(app)
  await app
    .locator('.row')
    .filter({ hasText: 'Test bridge hold' })
    .getByRole('button', { name: 'Edit' })
    .click()
  await app.getByLabel('How often').selectOption('daily')
  await app.getByRole('button', { name: 'Save' }).click()

  await app.getByRole('button', { name: 'Today' }).click()
  const band = app.getByRole('region', { name: 'Every day' })
  await expect(band.getByText('Test bridge hold')).toBeVisible()
  // Dailies never gate a cycle, so the cycle count drops back.
  await expect(app.getByText('16 left')).toBeVisible()
})

test('B6 — removing an exercise hides it but keeps its history', async ({ app }) => {
  const name = 'Push-ups'
  await mark(app, name).click()
  await expect.poll(() => psql('select count(*) from exercise_logs')).toBe('1')

  await settings(app)
  app.on('dialog', (d) => d.accept())
  // Exact: "Push-ups" is a substring of three other exercise names.
  const settingsRow = app.locator('.row').filter({ has: app.getByText(name, { exact: true }) })
  await settingsRow.getByRole('button', { name: 'Remove' }).click()

  await expect(settingsRow).toHaveCount(0)
  await app.getByRole('button', { name: 'Today' }).click()
  await expect(mark(app, name)).toHaveCount(0)

  // Soft delete: the log survives, so old history stays resolvable to a name.
  await expect
    .poll(() => psql("select count(*) from exercises where name = 'Push-ups' and archived_at is not null"))
    .toBe('1')
  expect(await psql('select count(*) from exercise_logs')).toBe('1')
})

test('B6 — the password can be changed and used to sign back in', async ({ app, context }) => {
  const OLD = process.env.EXSE_PASSWORD ?? 'testpass123'
  const NEW = 'changed-in-test-987'

  await settings(app)
  await app.getByLabel('Current password').fill(OLD)
  await app.getByLabel('New password').fill(NEW)
  await app.getByRole('button', { name: 'Change password' }).click()
  await expect(app.getByText('Password changed.')).toBeVisible()

  await context.clearCookies()
  await app.evaluate(() => localStorage.clear())
  await app.goto('/')
  await app.getByLabel('Username').fill('admin')
  await app.getByLabel('Password').fill(OLD)
  await app.getByRole('button', { name: 'Sign in' }).click()
  await expect(app.getByText(/wrong|invalid|incorrect/i)).toBeVisible()

  await app.getByLabel('Password').fill(NEW)
  await app.getByRole('button', { name: 'Sign in' }).click()
  await expect(app.getByRole('navigation')).toBeVisible()

  // Put it back so the rest of the suite (and the next run) still works.
  await app.getByRole('button', { name: 'Settings' }).click()
  await app.getByLabel('Current password').fill(NEW)
  await app.getByLabel('New password').fill(OLD)
  await app.getByRole('button', { name: 'Change password' }).click()
  await expect(app.getByText('Password changed.')).toBeVisible()
})
