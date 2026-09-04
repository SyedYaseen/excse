// The local reducer deliberately mirrors the server's op handling in
// src/routes/state.rs. Drift between the two is the main risk in a local-first
// design, so these assert the same rules the Rust integration tests do.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reduce } from './store.js'

const TODAY = '2026-09-04'
const EARLIER = '2026-09-02'

function base(over = {}) {
  return {
    exercises: [
      {
        id: 'a',
        name: 'Superman',
        category: 'Back',
        cadence: 'cycle',
        sortOrder: 0,
        skipStreak: 0,
        completedOn: null,
      },
      {
        id: 'b',
        name: 'Push-ups',
        category: 'Chest',
        cadence: 'cycle',
        sortOrder: 1,
        skipStreak: 0,
        completedOn: null,
      },
      {
        id: 'c',
        name: 'Crunches',
        category: 'Core',
        cadence: 'daily',
        sortOrder: 2,
        skipStreak: 0,
        completedOn: null,
      },
    ],
    cycle: { id: 'c1', seq: 1, startedOn: '2026-09-01', endedOn: null },
    pastCycles: [],
    logs: [],
    activeDays: [],
    retentionDays: 21,
    ...over,
  }
}

const find = (s, id) => s.exercises.find((e) => e.id === id)

test('tick records the log, the day, and cycle completion', () => {
  const s = reduce(base(), { type: 'tick', exerciseId: 'a', day: TODAY })
  assert.deepEqual(s.logs, [{ exerciseId: 'a', day: TODAY }])
  assert.deepEqual(s.activeDays, [TODAY])
  assert.equal(find(s, 'a').completedOn, TODAY)
})

test('ticking a daily marks the day but never cycle progress', () => {
  const s = reduce(base(), { type: 'tick', exerciseId: 'c', day: TODAY })
  assert.deepEqual(s.activeDays, [TODAY])
  assert.equal(find(s, 'c').completedOn, null)
})

test('tick is idempotent', () => {
  let s = base()
  const op = { type: 'tick', exerciseId: 'a', day: TODAY }
  s = reduce(reduce(s, op), op)
  assert.equal(s.logs.length, 1)
  assert.equal(s.activeDays.length, 1)
})

test('untick retracts the day when nothing else was logged', () => {
  let s = reduce(base(), { type: 'tick', exerciseId: 'a', day: TODAY })
  s = reduce(s, { type: 'untick', exerciseId: 'a', day: TODAY })
  assert.deepEqual(s.activeDays, [], 'a mis-tap left a permanent workout behind')
  assert.equal(find(s, 'a').completedOn, null)
})

test('untick keeps the day when another exercise is still logged', () => {
  let s = base()
  s = reduce(s, { type: 'tick', exerciseId: 'a', day: TODAY })
  s = reduce(s, { type: 'tick', exerciseId: 'b', day: TODAY })
  s = reduce(s, { type: 'untick', exerciseId: 'a', day: TODAY })
  assert.deepEqual(s.activeDays, [TODAY])
})

test('a repeat later in the cycle logs the day without moving completion', () => {
  let s = reduce(base(), { type: 'tick', exerciseId: 'a', day: EARLIER })
  s = reduce(s, { type: 'tick', exerciseId: 'a', day: TODAY })
  assert.equal(s.logs.length, 2)
  assert.deepEqual(s.activeDays, [EARLIER, TODAY])
  assert.equal(find(s, 'a').completedOn, EARLIER)
})

test('unticking a repeat leaves the original completion intact', () => {
  let s = base()
  s = reduce(s, { type: 'tick', exerciseId: 'a', day: EARLIER })
  s = reduce(s, { type: 'tick', exerciseId: 'a', day: TODAY })
  s = reduce(s, { type: 'untick', exerciseId: 'a', day: TODAY })
  assert.equal(find(s, 'a').completedOn, EARLIER)
})

test('ending early bumps skip debt only for the undone rotation', () => {
  let s = reduce(base(), { type: 'tick', exerciseId: 'a', day: TODAY })
  s = reduce(s, { type: 'endCycle', day: TODAY })

  assert.equal(find(s, 'a').skipStreak, 0, 'a completed exercise gained debt')
  assert.equal(find(s, 'b').skipStreak, 1, 'a skipped exercise gained none')
  assert.equal(find(s, 'c').skipStreak, 0, 'a daily was penalised')

  for (const e of s.exercises) assert.equal(e.completedOn, null)
  assert.equal(s.cycle.seq, 2)
  assert.equal(s.pastCycles[0].endedEarly, true)
  assert.equal(s.pastCycles[0].doneCount, 1)
  assert.equal(s.pastCycles[0].totalCount, 2)
})

test('a fully completed cycle is not marked early', () => {
  let s = base()
  s = reduce(s, { type: 'tick', exerciseId: 'a', day: TODAY })
  s = reduce(s, { type: 'tick', exerciseId: 'b', day: TODAY })
  s = reduce(s, { type: 'endCycle', day: TODAY })
  assert.equal(s.pastCycles[0].endedEarly, false)
})

test('skip debt compounds across cycles and clears on completion', () => {
  let s = base()
  s = reduce(s, { type: 'endCycle', day: TODAY })
  s = reduce(s, { type: 'endCycle', day: TODAY })
  assert.equal(find(s, 'a').skipStreak, 2)

  s = reduce(s, { type: 'tick', exerciseId: 'a', day: TODAY })
  s = reduce(s, { type: 'endCycle', day: TODAY })
  assert.equal(find(s, 'a').skipStreak, 0)
})

test('ending a cycle keeps the history it closed', () => {
  let s = reduce(base(), { type: 'tick', exerciseId: 'a', day: TODAY })
  s = reduce(s, { type: 'endCycle', day: TODAY })
  assert.deepEqual(s.activeDays, [TODAY], 'resetting a cycle erased history')
  assert.equal(s.logs.length, 1)
})

test('upsert edits in place and preserves earned skip debt', () => {
  let s = base()
  s = reduce(s, { type: 'endCycle', day: TODAY })
  assert.equal(find(s, 'a').skipStreak, 1)

  s = reduce(s, {
    type: 'upsertExercise',
    id: 'a',
    name: 'Superman hold',
    category: 'Back',
    cadence: 'cycle',
    sortOrder: 0,
  })
  assert.equal(find(s, 'a').name, 'Superman hold')
  assert.equal(find(s, 'a').skipStreak, 1, 'renaming wiped skip debt')
  assert.equal(s.exercises.length, 3)
})

test('upsert with an unseen id appends', () => {
  const s = reduce(base(), {
    type: 'upsertExercise',
    id: 'z',
    name: 'Wall sit',
    category: 'Legs',
    cadence: 'cycle',
    sortOrder: 9,
  })
  assert.equal(s.exercises.length, 4)
})

test('archive removes it from the working set', () => {
  const s = reduce(base(), { type: 'archiveExercise', id: 'a' })
  assert.equal(find(s, 'a'), undefined)
  assert.equal(s.exercises.length, 2)
})

test('reorder assigns sort order by position', () => {
  const s = reduce(base(), { type: 'reorder', ids: ['c', 'b', 'a'] })
  assert.equal(find(s, 'c').sortOrder, 0)
  assert.equal(find(s, 'b').sortOrder, 1)
  assert.equal(find(s, 'a').sortOrder, 2)
})
