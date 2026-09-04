import { expect, psql, test } from '../fixtures.js'

const mark = (app, name) => app.getByRole('checkbox', { name, exact: true })

test('D1 — tally marks are keyboard reachable and toggle on Space and Enter', async ({ app }) => {
  const first = app.locator('.exercise-name').first()
  const name = (await first.textContent()).trim()
  const target = mark(app, name)

  await target.focus()
  await expect(target).toBeFocused()

  // A visible focus ring, not just a focusable element.
  const ring = await target.evaluate((el) => {
    const s = getComputedStyle(el, ':focus-visible')
    return { outlineWidth: s.outlineWidth, boxShadow: s.boxShadow, outlineStyle: s.outlineStyle }
  })
  expect(
    ring.outlineStyle !== 'none' || (ring.boxShadow && ring.boxShadow !== 'none'),
    `no focus indicator: ${JSON.stringify(ring)}`,
  ).toBe(true)

  await expect(target).toHaveAttribute('aria-checked', 'false')
  await app.keyboard.press('Space')
  await expect(mark(app, name)).toHaveAttribute('aria-checked', 'true')

  await mark(app, name).focus()
  await app.keyboard.press('Enter')
  await expect(mark(app, name)).toHaveAttribute('aria-checked', 'false')
})

test('D1 — Tab reaches every tally mark on Today', async ({ app }) => {
  const total = await app.getByRole('checkbox').count()
  const reached = new Set()

  for (let i = 0; i < 80 && reached.size < total; i++) {
    await app.keyboard.press('Tab')
    const label = await app.evaluate(() => {
      const el = document.activeElement
      return el?.getAttribute('role') === 'checkbox' ? el.getAttribute('aria-label') : null
    })
    if (label) reached.add(label)
  }
  expect(reached.size).toBe(total)
})

test('D2 — the year view is one labelled image, not 364 announcements', async ({ app }) => {
  psql(`insert into active_days (user_id, day)
        select u.id, d::date from users u,
               generate_series(current_date - 30, current_date, interval '1 day') d
        where u.username = 'admin' on conflict do nothing`)
  await app.reload()
  await app.getByRole('button', { name: 'History' }).click()

  const year = app.getByRole('img')
  await expect(year).toHaveCount(1)
  await expect(year).toHaveAttribute('aria-label', /\d+ days exercised/)
})

test('D3 — reduced motion turns ticking into an instant state change', async ({ app }) => {
  await app.emulateMedia({ reducedMotion: 'reduce' })
  const name = (await app.locator('.exercise-name').first().textContent()).trim()

  const durations = await mark(app, name).evaluate((el) =>
    [...el.querySelectorAll('line')].map((l) => getComputedStyle(l).transitionDuration),
  )
  // theme.css uses the conventional 0.00001s rather than 0s, so that
  // transitionend still fires. Anything under a millisecond is instant.
  for (const d of durations) {
    expect.soft(parseFloat(d), `transition-duration ${d}`).toBeLessThan(0.001)
  }
})
