import { test } from 'node:test'
import assert from 'node:assert/strict'
import { organise, cycleProgress, streak, longestStreak, isDone, loggedOn } from './sort.js'

const TODAY = '2026-09-04'

let seq = 0
function ex(over = {}) {
  return {
    id: `e${seq++}`,
    name: over.name ?? `Exercise ${seq}`,
    category: 'Core',
    cadence: 'cycle',
    sortOrder: 0,
    skipStreak: 0,
    completedOn: null,
    ...over,
  }
}

const names = (cats) => cats.map((c) => c.name)

test('a category you have not started outranks one you are partway through', () => {
  const items = [
    ex({ category: 'Chest', completedOn: TODAY }),
    ex({ category: 'Chest' }),
    ex({ category: 'Back' }),
    ex({ category: 'Back' }),
  ]
  const { categories } = organise(items, [], TODAY)
  assert.deepEqual(names(categories), ['Back', 'Chest'])
})

test('a completed category sinks below every incomplete one', () => {
  const items = [
    ex({ category: 'Chest', completedOn: TODAY }),
    ex({ category: 'Back' }),
    ex({ category: 'Legs', completedOn: TODAY }),
    ex({ category: 'Legs' }),
  ]
  const { categories } = organise(items, [], TODAY)
  assert.deepEqual(names(categories), ['Back', 'Legs', 'Chest'])
  assert.equal(categories.at(-1).complete, true)
})

test('skip debt breaks a tie between two untouched categories', () => {
  const items = [
    ex({ category: 'Chest' }),
    ex({ category: 'Back', skipStreak: 3 }),
    ex({ category: 'Legs', skipStreak: 1 }),
  ]
  const { categories } = organise(items, [], TODAY)
  assert.deepEqual(names(categories), ['Back', 'Legs', 'Chest'])
})

test('neglect breaks a tie when completion and skip debt match', () => {
  const recent = ex({ category: 'Chest' })
  const stale = ex({ category: 'Back' })
  const logs = [
    { exerciseId: recent.id, day: '2026-09-03' },
    { exerciseId: stale.id, day: '2026-08-01' },
  ]
  const { categories } = organise([recent, stale], logs, TODAY)
  assert.deepEqual(names(categories), ['Back', 'Chest'])
})

test('a never-trained category outranks a long-untrained one', () => {
  const stale = ex({ category: 'Back' })
  const never = ex({ category: 'Legs' })
  const logs = [{ exerciseId: stale.id, day: '2020-01-01' }]
  const { categories } = organise([stale, never], logs, TODAY)
  assert.deepEqual(names(categories), ['Legs', 'Back'])
})

test('within a category, undone come first and carried-over skips lead them', () => {
  const items = [
    ex({ name: 'Done', completedOn: TODAY, sortOrder: 0 }),
    ex({ name: 'Fresh', sortOrder: 1 }),
    ex({ name: 'Skipped twice', skipStreak: 2, sortOrder: 2 }),
  ]
  const { categories } = organise(items, [], TODAY)
  assert.deepEqual(
    categories[0].exercises.map((e) => e.name),
    ['Skipped twice', 'Fresh', 'Done'],
  )
})

test('manual order is the last tie-break, never the first', () => {
  const items = [
    ex({ name: 'First manually', sortOrder: 0, skipStreak: 0 }),
    ex({ name: 'Second manually', sortOrder: 1, skipStreak: 5 }),
  ]
  const { categories } = organise(items, [], TODAY)
  assert.deepEqual(
    categories[0].exercises.map((e) => e.name),
    ['Second manually', 'First manually'],
  )
})

test('dailies are pulled out of the rotation entirely', () => {
  const items = [
    ex({ name: 'Crunches', cadence: 'daily' }),
    ex({ name: 'Superman', category: 'Back' }),
  ]
  const { daily, categories } = organise(items, [], TODAY)
  assert.deepEqual(
    daily.map((e) => e.name),
    ['Crunches'],
  )
  assert.deepEqual(names(categories), ['Back'])
})

test('a daily is done when logged today, regardless of cycle state', () => {
  const daily = ex({ cadence: 'daily' })
  const logs = [{ exerciseId: daily.id, day: TODAY }]
  const done = loggedOn(logs, TODAY)
  assert.equal(isDone(daily, done), true)
  assert.equal(isDone(ex({ cadence: 'daily' }), done), false)
})

test('a daily logged yesterday is not done today', () => {
  const daily = ex({ cadence: 'daily' })
  const logs = [{ exerciseId: daily.id, day: '2026-09-03' }]
  assert.equal(isDone(daily, loggedOn(logs, TODAY)), false)
})

test('cycle progress ignores dailies', () => {
  const items = [
    ex({ cadence: 'daily' }),
    ex({ completedOn: TODAY }),
    ex({ completedOn: TODAY }),
  ]
  assert.deepEqual(cycleProgress(items), { done: 2, total: 2, complete: true })
})

test('an empty rotation is not a complete cycle', () => {
  assert.equal(cycleProgress([ex({ cadence: 'daily' })]).complete, false)
})

test('streak counts back from today', () => {
  assert.equal(streak(['2026-09-02', '2026-09-03', '2026-09-04'], TODAY), 3)
})

test('not having exercised yet today does not break the streak', () => {
  assert.equal(streak(['2026-09-02', '2026-09-03'], TODAY), 2)
})

test('a gap ends the streak', () => {
  assert.equal(streak(['2026-08-01', '2026-09-01'], TODAY), 0)
  assert.equal(streak([], TODAY), 0)
})

test('longest streak finds the best run anywhere in the history', () => {
  const days = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-05-05', '2026-05-06']
  assert.equal(longestStreak(days), 3)
  assert.equal(longestStreak([]), 0)
  assert.equal(longestStreak(['2026-01-01']), 1)
})
