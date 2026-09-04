// Local-first store.
//
// Reads always come from local state, so ticking never waits on the network.
// Every mutation applies locally at once and appends an op to an outbox that
// sync.js drains. The op shapes and their effects mirror the server exactly --
// see src/routes/state.rs; the two must stay in step.

import { today as todayISO } from './dates.js'

const STATE_KEY = 'exse.state'
const OUTBOX_KEY = 'exse.outbox'

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private mode or a full quota. The app still works for this session.
  }
}

let state = read(STATE_KEY, null)
let outbox = read(OUTBOX_KEY, [])
let status = { syncing: false, pending: outbox.length, authed: null, error: null }

const listeners = new Set()
let snapshot = build()

function build() {
  return { state, outbox, status }
}

function emit() {
  snapshot = build()
  listeners.forEach((fn) => fn())
}

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getSnapshot() {
  return snapshot
}

export function getState() {
  return state
}

export function getOutbox() {
  return outbox
}

export function setStatus(patch) {
  status = { ...status, ...patch, pending: outbox.length }
  emit()
}

/** Replaces local state with the server's. */
export function setServerState(next) {
  state = next
  write(STATE_KEY, state)
  emit()
}

export function clearLocal() {
  state = null
  outbox = []
  localStorage.removeItem(STATE_KEY)
  localStorage.removeItem(OUTBOX_KEY)
  emit()
}

/** Drops the first n ops -- exactly those a flush sent. */
export function dropSentOps(n) {
  outbox = outbox.slice(n)
  write(OUTBOX_KEY, outbox)
}

/** Re-applies ops locally on top of freshly-arrived server state. */
export function replayOutbox() {
  for (const op of outbox) state = reduce(state, op)
  write(STATE_KEY, state)
  emit()
}

// Set by sync.js, which cannot be imported here without a cycle.
let onDispatch = () => {}
export function setOnDispatch(fn) {
  onDispatch = fn
}

/** Applies an op locally and queues it for the server. */
export function dispatch(op) {
  state = reduce(state, op)
  outbox = [...outbox, op]
  write(STATE_KEY, state)
  write(OUTBOX_KEY, outbox)
  emit()
  onDispatch(op)
}

// ---------------------------------------------------------------------------
// Local reducer -- mirrors the server's op handling
// ---------------------------------------------------------------------------

export function reduce(s, op) {
  if (!s) return s
  switch (op.type) {
    case 'tick':
      return tick(s, op)
    case 'untick':
      return untick(s, op)
    case 'endCycle':
      return endCycle(s, op)
    case 'upsertExercise':
      return upsertExercise(s, op)
    case 'archiveExercise':
      return { ...s, exercises: s.exercises.filter((e) => e.id !== op.id) }
    case 'reorder':
      return {
        ...s,
        exercises: s.exercises.map((e) => {
          const i = op.ids.indexOf(e.id)
          return i === -1 ? e : { ...e, sortOrder: i }
        }),
      }
    default:
      return s
  }
}

function tick(s, { exerciseId, day }) {
  const ex = s.exercises.find((e) => e.id === exerciseId)
  if (!ex) return s

  const logged = s.logs.some((l) => l.exerciseId === exerciseId && l.day === day)
  return {
    ...s,
    logs: logged ? s.logs : [...s.logs, { exerciseId, day }],
    activeDays: s.activeDays.includes(day)
      ? s.activeDays
      : [...s.activeDays, day].sort(),
    // Only the first completion of a cycle sets the date. Ticking it again
    // later in the same cycle is a repeat: it logs the day and nothing else.
    exercises: s.exercises.map((e) =>
      e.id === exerciseId && e.cadence === 'cycle' && e.completedOn == null
        ? { ...e, completedOn: day }
        : e,
    ),
  }
}

function untick(s, { exerciseId, day }) {
  const ex = s.exercises.find((e) => e.id === exerciseId)
  if (!ex) return s

  const logs = s.logs.filter((l) => !(l.exerciseId === exerciseId && l.day === day))
  // The day only stops counting once nothing else was logged against it.
  const stillUsed = logs.some((l) => l.day === day)

  return {
    ...s,
    logs,
    activeDays: stillUsed ? s.activeDays : s.activeDays.filter((d) => d !== day),
    exercises: s.exercises.map((e) =>
      e.id === exerciseId && e.cadence === 'cycle' && e.completedOn === day
        ? { ...e, completedOn: null }
        : e,
    ),
  }
}

function endCycle(s, { day }) {
  const rotation = s.exercises.filter((e) => e.cadence === 'cycle')
  const done = rotation.filter((e) => e.completedOn != null).length
  const total = rotation.length

  const closed = {
    ...s.cycle,
    endedOn: day,
    endedEarly: done < total,
    doneCount: done,
    totalCount: total,
  }

  return {
    ...s,
    // Skipping compounds across cycles; completing it clears the debt.
    exercises: s.exercises.map((e) =>
      e.cadence === 'cycle'
        ? {
            ...e,
            skipStreak: e.completedOn == null ? e.skipStreak + 1 : 0,
            completedOn: null,
          }
        : { ...e, completedOn: null },
    ),
    pastCycles: [closed, ...s.pastCycles],
    cycle: {
      id: crypto.randomUUID(),
      seq: s.cycle.seq + 1,
      startedOn: day,
      endedOn: null,
      endedEarly: false,
      doneCount: null,
      totalCount: null,
    },
  }
}

function upsertExercise(s, op) {
  const exists = s.exercises.some((e) => e.id === op.id)
  const next = {
    id: op.id,
    name: op.name,
    category: op.category,
    cadence: op.cadence,
    sortOrder: op.sortOrder,
    skipStreak: 0,
    completedOn: null,
  }
  return {
    ...s,
    exercises: exists
      ? s.exercises.map((e) => (e.id === op.id ? { ...e, ...next, skipStreak: e.skipStreak, completedOn: e.completedOn } : e))
      : [...s.exercises, next],
  }
}

// ---------------------------------------------------------------------------
// Action helpers
// ---------------------------------------------------------------------------

export const actions = {
  tick: (exerciseId, day = todayISO()) => dispatch({ type: 'tick', exerciseId, day }),
  untick: (exerciseId, day = todayISO()) => dispatch({ type: 'untick', exerciseId, day }),
  endCycle: (day = todayISO()) => dispatch({ type: 'endCycle', day }),
  upsertExercise: (e) => dispatch({ type: 'upsertExercise', ...e }),
  archiveExercise: (id) => dispatch({ type: 'archiveExercise', id }),
  reorder: (ids) => dispatch({ type: 'reorder', ids }),
}
