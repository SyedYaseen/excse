import { expect, psql, test } from '../fixtures.js'

/** WCAG relative luminance from an "rgb(r, g, b)" string. */
function luminance(rgb) {
  const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map((n) => {
    const c = Number(n) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

test('controls are big enough, and destructive ones are not crowded', async ({ app }) => {
  for (const tab of ['Today', 'History', 'Settings']) {
    await app.getByRole('button', { name: tab }).click()

    // The mid-workout controls -- tally marks and the tab bar -- get the full
    // 44px in both dimensions. Inline text links in Settings are held to
    // WCAG 2.5.8's 24px minimum plus a full-height 44px row.
    const bad = await app.evaluate(() => {
      const out = []
      for (const el of document.querySelectorAll('button, [role="checkbox"], input, select')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0) continue
        const primary = el.closest('.nav') || el.getAttribute('role') === 'checkbox'
        const min = primary ? 44 : 24
        const label = el.textContent.trim().slice(0, 20) || el.tagName
        if (r.height < 44 || r.width < min) out.push(`${label} ${r.width}x${r.height}`)
      }
      return out
    })
    expect.soft(bad, `${tab} controls too small`).toEqual([])
  }

  // Remove sits next to Edit and cannot be undone from the UI, so it needs
  // real clearance rather than a text-link's default word spacing.
  const gap = await app.evaluate(() => {
    const row = document.querySelector('.row')
    const [edit, remove] = [...row.querySelectorAll('button')]
    return remove.getBoundingClientRect().left - edit.getBoundingClientRect().right
  })
  expect(gap).toBeGreaterThanOrEqual(16)
})

test('A4 — the year view opens on the most recent weeks, not the empty past', async ({ app }) => {
  psql(`insert into active_days (user_id, day)
        select u.id, d::date from users u,
               generate_series(current_date - 120, current_date, interval '1 day') d
        where u.username = 'admin' on conflict do nothing`)
  await app.reload()
  await app.getByRole('button', { name: 'History' }).click()
  await expect(app.getByText('day streak')).toBeVisible()

  const y = await app.evaluate(() => {
    const el = document.querySelector('.year')
    const box = el.getBoundingClientRect()
    const on = [...el.querySelectorAll('.tally-sm.on')]
    const visible = on.filter((d) => {
      const b = d.getBoundingClientRect()
      return b.left >= box.left - 1 && b.right <= box.right + 1
    })
    return { total: on.length, visible: visible.length, scrollLeft: el.scrollLeft, scrollW: el.scrollWidth, clientW: el.clientWidth }
  })

  // Today is always in the rightmost column, so whatever is on screen must
  // include the run leading up to now rather than a year of blank grid.
  expect(y.total).toBeGreaterThan(100)
  expect(y.scrollLeft).toBeGreaterThan(y.scrollW - y.clientW - 2)
  expect(y.visible).toBeGreaterThan(y.total / 3)
})

test('A3 — the daily band sits above a rule that reads as two lines', async ({ app }) => {
  const rule = await app.evaluate(() => {
    const el = document.querySelector('.band-end')
    const cs = getComputedStyle(el)
    return {
      height: el.getBoundingClientRect().height,
      top: parseFloat(cs.borderTopWidth),
      bottom: parseFloat(cs.borderBottomWidth),
    }
  })
  expect(rule.top).toBeGreaterThan(0)
  expect(rule.bottom).toBeGreaterThan(0)
  // The gap between the hairlines is what makes it read as a double rule.
  expect(rule.height - rule.top - rule.bottom).toBeGreaterThanOrEqual(2)
})

test('A5 — the progress rule fills in proportion to the cycle', async ({ app }) => {
  const width = () =>
    app.evaluate(() => document.querySelector('.progress-fill').getBoundingClientRect().width)
  const track = await app.evaluate(
    () => document.querySelector('.progress-track').getBoundingClientRect().width,
  )
  expect(await width()).toBe(0)

  const names = (await app.locator('.exercise[data-done="false"] .exercise-name').allTextContents())
    .slice(0, 4)
    .map((s) => s.trim())
  for (const n of names) await app.getByRole('checkbox', { name: n, exact: true }).click()

  await expect(app.getByText('12 left')).toBeVisible()
  // The fill is animated, so settle before measuring.
  await expect.poll(width).toBeCloseTo((track * 4) / 16, 0)
})

test('text meets 4.5:1 against its background in this theme', async ({ app }, testInfo) => {
  const samples = await app.evaluate(() => {
    const pick = ['.exercise-name', '.category-head', '.progress-meta', '.skip-badge', '.muted', '.stat-label', '.nav button']
    const out = []
    for (const sel of pick) {
      const el = document.querySelector(sel)
      if (!el) continue
      let bg = 'rgba(0, 0, 0, 0)'
      for (let n = el; n; n = n.parentElement) {
        const c = getComputedStyle(n).backgroundColor
        if (c && !c.startsWith('rgba(0, 0, 0, 0')) { bg = c; break }
      }
      out.push({ sel, fg: getComputedStyle(el).color, bg })
    }
    return out
  })
  for (const { sel, fg, bg } of samples) {
    expect.soft(contrast(fg, bg), `${testInfo.project.name} ${sel} (${fg} on ${bg})`).toBeGreaterThan(4.5)
  }
})

test('the theme choice is announced, not just coloured', async ({ app }) => {
  await app.getByRole('button', { name: 'Settings' }).click()
  await expect(app.getByRole('button', { name: 'System', pressed: true })).toBeVisible()
  await app.getByRole('button', { name: 'Dark' }).click()
  await expect(app.getByRole('button', { name: 'Dark', pressed: true })).toBeVisible()
  await expect(app.getByRole('button', { name: 'System', pressed: false })).toBeVisible()
  await app.getByRole('button', { name: 'System' }).click()
})
