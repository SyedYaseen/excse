import { execFileSync } from 'node:child_process'
import { test as base, expect } from '@playwright/test'

export const USER = process.env.EXSE_USER ?? 'admin'
export const PASSWORD = process.env.EXSE_PASSWORD ?? 'testpass123'

const DB_URL = process.env.DATABASE_URL ?? 'postgres://exse:exse@127.0.0.1:5432/exse'

/**
 * How many rotation exercises the seeded catalogue has, and how many
 * exercises in total. Read from the database rather than hard-coded: the
 * catalogue is the user's own list and changes, and a test that asserts "16
 * left" is really asserting the seed, not the behaviour.
 */
export function rotationCount() {
  return Number(
    psql("select count(*) from exercises where cadence = 'cycle' and archived_at is null"),
  )
}

export function exerciseCount() {
  return Number(psql('select count(*) from exercises where archived_at is null'))
}

/** Mirrors DAY_MIN_EXERCISES on the server. */
export const DAY_THRESHOLD = Number(process.env.DAY_MIN_EXERCISES ?? 4)

/**
 * Reset everything except the user, their exercises and the permanent
 * day-level record's *table* -- so each test starts on cycle 1 with nothing
 * ticked. Run over psql rather than through the API because there is
 * deliberately no reset endpoint.
 */
export function resetState(sql = '') {
  const script = `
    begin;
    delete from exercise_logs;
    delete from active_days;
    delete from cycle_skips;
    delete from cycles;
    -- Anything a test created is named "Test ..."; drop it so every test
    -- starts from the same seeded catalogue.
    delete from exercises where name like 'Test %';
    update exercises set completed_on = null, skip_streak = 0, archived_at = null;
    insert into cycles (user_id, seq, started_on)
      select id, 1, current_date from users;
    ${sql}
    commit;
  `
  return psql(script)
}

export function psql(sql) {
  return execFileSync('psql', [DB_URL, '-v', 'ON_ERROR_STOP=1', '-tAc', sql], {
    encoding: 'utf8',
  }).trim()
}

/** Sign in through the real login form, so the cookie is set the real way. */
export async function signIn(page) {
  await page.goto('/')
  const password = page.getByLabel('Password')
  if (await password.isVisible().catch(() => false)) {
    await page.getByLabel('Username').fill(USER)
    await password.fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
  }
  await expect(page.getByRole('navigation')).toBeVisible()
}

export const test = base.extend({
  // A signed-in page on a clean cycle 1. Almost every test wants this.
  app: async ({ page }, use) => {
    resetState()
    await signIn(page)
    await use(page)
  },
})

export { expect }
