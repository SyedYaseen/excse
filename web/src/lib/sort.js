// The ordering rules -- the reason this app exists.
//
// Lives on the client because the local-first store has to re-sort without
// the server. Pure functions over plain data so they can be tested directly.

import { addDays, daysBetween } from './dates.js'

/** Latest day each exercise was logged, from the retained history. */
function lastLoggedByExercise(logs) {
  const out = new Map()
  for (const { exerciseId, day } of logs) {
    const prev = out.get(exerciseId)
    if (!prev || day > prev) out.set(exerciseId, day)
  }
  return out
}

export function isDone(exercise, doneToday) {
  return exercise.cadence === 'daily'
    ? doneToday.has(exercise.id)
    : exercise.completedOn != null
}

/** Set of exercise ids logged on `day`. */
export function loggedOn(logs, day) {
  return new Set(logs.filter((l) => l.day === day).map((l) => l.exerciseId))
}

/**
 * Groups the rotation into categories and orders both levels.
 *
 * Categories, in order:
 *   1. least complete first, so a category you have not started floats up
 *   2. most skip debt first, so what you dodged last cycle comes back at you
 *   3. longest untrained first, which nudges you off your favourites
 *   4. name, only so the order is stable
 *
 * Within a category: undone first, highest skip debt first among those, then
 * your manual order. Done ones sink and dim. A fully complete category has
 * ratio 1 so it lands below every incomplete one by rule 1 alone.
 */
export function organise(exercises, logs, today) {
  const doneToday = loggedOn(logs, today)
  const lastLogged = lastLoggedByExercise(logs)

  const daily = exercises
    .filter((e) => e.cadence === 'daily')
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))

  const byCategory = new Map()
  for (const e of exercises) {
    if (e.cadence !== 'cycle') continue
    if (!byCategory.has(e.category)) byCategory.set(e.category, [])
    byCategory.get(e.category).push(e)
  }

  const categories = []
  for (const [name, items] of byCategory) {
    const total = items.length
    if (total === 0) continue
    const done = items.filter((e) => e.completedOn != null).length
    const skipDebt = items.reduce((n, e) => n + e.skipStreak, 0)

    // Never trained sorts as infinitely long ago, so it outranks anything
    // that has at least been touched.
    let daysSince = Infinity
    for (const e of items) {
      const day = lastLogged.get(e.id)
      if (day) daysSince = Math.min(daysSince, daysBetween(day, today))
    }

    categories.push({
      name,
      total,
      done,
      complete: done === total,
      ratio: done / total,
      skipDebt,
      daysSince,
      exercises: [...items].sort(orderWithinCategory),
    })
  }

  categories.sort(
    (a, b) =>
      a.ratio - b.ratio ||
      b.skipDebt - a.skipDebt ||
      cmpDaysSince(b.daysSince, a.daysSince) ||
      a.name.localeCompare(b.name),
  )

  return { daily, categories, doneToday }
}

/**
 * A positional snapshot of an organised list.
 *
 * The ordering rules are the point of this app, but running them after every
 * tick moves the row under your thumb and loses your place in a muscle group
 * mid-set. So they run when you ask -- on open, on a new day, on a new cycle,
 * or on Re-sort -- and the answer is frozen until the next time.
 */
export function freezeOrder(organised) {
  return {
    categories: organised.categories.map((c) => c.name),
    exercises: Object.fromEntries(
      organised.categories.map((c) => [c.name, c.exercises.map((e) => e.id)]),
    ),
    // Which categories were already finished at snapshot time. Only these
    // collapse into the completed zone; one you finish *now* reads as done
    // where it stands rather than vanishing.
    settled: organised.categories.filter((c) => c.complete).map((c) => c.name),
  }
}

/** Re-imposes a snapshot on freshly organised data. Counts stay live. */
export function applyOrder(organised, order) {
  if (!order) return organised

  const rank = new Map(order.categories.map((name, i) => [name, i]))
  const settled = new Set(order.settled)

  // Anything added since the snapshot has no rank and lands at the end, which
  // is the one place it cannot displace something you are working through.
  const at = (name) => (rank.has(name) ? rank.get(name) : Number.MAX_SAFE_INTEGER)

  const categories = organised.categories
    .map((c) => ({
      ...c,
      settled: settled.has(c.name),
      exercises: inSnapshotOrder(c.exercises, order.exercises[c.name]),
    }))
    .sort((a, b) => at(a.name) - at(b.name) || a.name.localeCompare(b.name))

  return { ...organised, categories }
}

function inSnapshotOrder(exercises, ids) {
  if (!ids) return exercises
  const rank = new Map(ids.map((id, i) => [id, i]))
  const at = (e) => (rank.has(e.id) ? rank.get(e.id) : Number.MAX_SAFE_INTEGER)
  return [...exercises].sort((a, b) => at(a) - at(b))
}

/**
 * The muscle group the ordering rules would put first right now -- least
 * complete, most skip debt, longest untrained. Read live rather than from the
 * snapshot, so it keeps pointing at the right group without anything moving.
 */
export function suggestNext(organised) {
  return organised.categories.find((c) => !c.complete)?.name ?? null
}

// Infinity - Infinity is NaN, which would corrupt the comparator.
function cmpDaysSince(a, b) {
  if (a === b) return 0
  if (a === Infinity) return 1
  if (b === Infinity) return -1
  return a - b
}

function orderWithinCategory(a, b) {
  const aDone = a.completedOn != null
  const bDone = b.completedOn != null
  if (aDone !== bDone) return aDone ? 1 : -1
  if (!aDone && a.skipStreak !== b.skipStreak) return b.skipStreak - a.skipStreak
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)
}

/** Cycle completion counts only the rotation; dailies never gate a cycle. */
export function cycleProgress(exercises) {
  const items = exercises.filter((e) => e.cadence === 'cycle')
  const done = items.filter((e) => e.completedOn != null).length
  return { done, total: items.length, complete: items.length > 0 && done === items.length }
}

/**
 * Consecutive days ending today. A day you have not exercised yet does not
 * break the streak -- it only ends once yesterday is missed too.
 */
export function streak(activeDays, today) {
  const set = new Set(activeDays)
  if (set.size === 0) return 0

  let cursor = set.has(today) ? today : addDays(today, -1)
  if (!set.has(cursor)) return 0

  let n = 0
  while (set.has(cursor)) {
    n++
    cursor = addDays(cursor, -1)
  }
  return n
}

export function longestStreak(activeDays) {
  if (activeDays.length === 0) return 0
  const sorted = [...activeDays].sort()
  let best = 1
  let run = 1
  for (let i = 1; i < sorted.length; i++) {
    run = daysBetween(sorted[i - 1], sorted[i]) === 1 ? run + 1 : 1
    if (run > best) best = run
  }
  return best
}
