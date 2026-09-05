import { expect, psql, test } from '../fixtures.js'

const settings = (app) => app.getByRole('button', { name: 'Settings' }).click()
const squat = (app) => app.getByRole('checkbox', { name: 'Squat', exact: true })

test('B9 — detailed entry asks for reps and weight, and it round-trips', async ({ app }) => {
  await settings(app)
  await expect(app.getByRole('button', { name: 'Off', exact: true })).toBeVisible()
  await app.getByRole('button', { name: 'Off', exact: true }).click()
  await expect(app.getByRole('button', { name: 'On', exact: true })).toBeVisible()

  await app.getByRole('button', { name: 'Today' }).click()
  await squat(app).click()

  const sheet = app.getByRole('dialog', { name: 'Log Squat' })
  await expect(sheet).toBeVisible()
  await sheet.getByLabel('Reps').fill('5')
  await sheet.getByLabel('Weight').fill('135')
  await sheet.getByRole('button', { name: 'Log it' }).click()

  await expect(squat(app)).toHaveAttribute('aria-checked', 'true')
  await expect(app.getByText('5 × 135')).toBeVisible()
  await expect
    .poll(() =>
      psql(
        `select reps, weight from exercise_logs el
           join exercises e on e.id = el.exercise_id
          where e.name = 'Squat'`,
      ),
    )
    .toBe('5|135')

  // Reload to prove it round-tripped through sync, not just local state.
  await app.reload()
  await expect(app.getByText('5 × 135')).toBeVisible()

  // Tapping a logged row while detailed entry is on reopens the sheet to
  // edit today's numbers in place, rather than instantly unticking.
  await squat(app).click()
  await expect(sheet.getByLabel('Reps')).toHaveValue('5')
  await sheet.getByLabel('Reps').fill('6')
  await sheet.getByRole('button', { name: 'Save' }).click()
  await expect(app.getByText('6 × 135')).toBeVisible()

  await squat(app).click()
  await sheet.getByRole('button', { name: 'Remove' }).click()
  await expect(squat(app)).toHaveAttribute('aria-checked', 'false')
  await expect(app.getByText('6 × 135')).toHaveCount(0)

  // Put it back so the rest of the suite still sees the instant-tap default.
  await settings(app)
  await app.getByRole('button', { name: 'On', exact: true }).click()
})
