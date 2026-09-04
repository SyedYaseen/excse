// Local dates only. Never UTC.
//
// The whole app hangs on this: a 21:00 workout has to be filed under the day
// you did it, and toISOString() would push it into tomorrow for anyone east of
// UTC. Every date crossing the wire is a plain YYYY-MM-DD string produced here.

export function toISO(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function today() {
  return toISO(new Date())
}

/** Parses YYYY-MM-DD to a Date at local midnight (not UTC midnight). */
export function fromISO(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(iso, n) {
  const d = fromISO(iso)
  d.setDate(d.getDate() + n)
  return toISO(d)
}

export function daysBetween(fromIso, toIso) {
  return Math.round((fromISO(toIso) - fromISO(fromIso)) / 86400000)
}

/** The last n days ending at `end`, oldest first. */
export function lastDays(end, n) {
  const out = []
  for (let i = n - 1; i >= 0; i--) out.push(addDays(end, -i))
  return out
}

/** "4 Sep", "4 Sep 2025" if it is not the current year. */
export function shortDate(iso, now = new Date()) {
  const d = fromISO(iso)
  const opts = { day: 'numeric', month: 'short' }
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric'
  return d.toLocaleDateString(undefined, opts)
}
