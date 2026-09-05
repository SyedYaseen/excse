import { useState } from 'react'
import { api } from '../lib/api.js'
import { actions, clearLocal, setServerState } from '../lib/store.js'
import { uuid } from '../lib/uuid.js'

const NEW_CATEGORY = '__new__'

const THEMES = [
  ['system', 'System'],
  ['light', 'Light'],
  ['dark', 'Dark'],
]

function ExerciseEditor({ exercise, categories, onDone }) {
  const [name, setName] = useState(exercise?.name ?? '')
  // A real <select> rather than a text input with a datalist: datalist's
  // suggestion dropdown does not render on most mobile browsers, and this is
  // a phone app. Choosing an existing category or "Add new category" is what
  // a combo box means here.
  const [categoryChoice, setCategoryChoice] = useState(
    exercise?.category ?? categories[0] ?? NEW_CATEGORY,
  )
  const [newCategory, setNewCategory] = useState('')
  const [cadence, setCadence] = useState(exercise?.cadence ?? 'cycle')

  const category = categoryChoice === NEW_CATEGORY ? newCategory : categoryChoice

  function save(e) {
    e.preventDefault()
    if (!name.trim() || !category.trim()) return
    actions.upsertExercise({
      id: exercise?.id ?? uuid(),
      name: name.trim(),
      category: category.trim(),
      cadence,
      sortOrder: exercise?.sortOrder ?? 999,
    })
    onDone()
  }

  return (
    <form onSubmit={save}>
      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <label className="field">
        <span>Muscle group</span>
        <select value={categoryChoice} onChange={(e) => setCategoryChoice(e.target.value)}>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          <option value={NEW_CATEGORY}>Add new category…</option>
        </select>
      </label>
      {categoryChoice === NEW_CATEGORY && (
        <label className="field">
          <span>New category name</span>
          <input
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            autoFocus={categories.length > 0}
          />
        </label>
      )}
      <label className="field">
        <span>How often</span>
        <select value={cadence} onChange={(e) => setCadence(e.target.value)}>
          <option value="cycle">Once per cycle</option>
          <option value="daily">Every day</option>
        </select>
      </label>
      <div className="sheet-actions">
        <button className="btn btn-primary">Save</button>
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function PasswordForm() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [msg, setMsg] = useState(null)

  async function submit(e) {
    e.preventDefault()
    setMsg(null)
    try {
      await api.changePassword(current, next)
      setCurrent('')
      setNext('')
      setMsg('Password changed.')
    } catch (err) {
      setMsg(err.message)
    }
  }

  return (
    <form onSubmit={submit}>
      {msg && <p className="error">{msg}</p>}
      <label className="field">
        <span>Current password</span>
        <input
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
        />
      </label>
      <label className="field">
        <span>New password</span>
        <input
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
        />
      </label>
      <button className="btn">Change password</button>
    </form>
  )
}

// Moves id one slot up (delta -1) or down (delta +1) within its own
// category and returns the new id order for that category, or null if the
// move is out of range. `sorted` must already be ordered by sortOrder.
function moveWithinCategory(sorted, category, id, delta) {
  const ids = sorted.filter((e) => e.category === category).map((e) => e.id)
  const i = ids.indexOf(id)
  const j = i + delta
  if (i === -1 || j < 0 || j >= ids.length) return null
  ;[ids[i], ids[j]] = [ids[j], ids[i]]
  return ids
}

/**
 * A per-account preference, not a client-local one like theme: it decides
 * whether the tap opens the entry sheet at all, so it has to follow the
 * account across devices rather than live in localStorage. Toggling it
 * round-trips through `/api/settings` and adopts the state that comes back,
 * the same way the reset button below does.
 */
function DetailedEntryToggle({ enabled }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  async function toggle() {
    setBusy(true)
    setMsg(null)
    try {
      const next = await api.setDetailedEntry(!enabled)
      setServerState(next)
    } catch (err) {
      setMsg(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      {msg && <p className="error">{msg}</p>}
      <button className="link link-icon" aria-pressed={enabled} onClick={toggle} disabled={busy}>
        {enabled ? 'On' : 'Off'}
      </button>
    </div>
  )
}

// TEMP: remove with api.resetProgress and the server route once asked.
function ResetProgressButton() {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  async function reset() {
    if (
      !confirm(
        'Reset all progress? This clears history, cycles, and the calendar. Your account and exercise list stay.',
      )
    ) {
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      await api.resetProgress()
      clearLocal()
      location.reload()
    } catch (err) {
      setMsg(err.message)
      setBusy(false)
    }
  }

  return (
    <div>
      {msg && <p className="error">{msg}</p>}
      <button className="btn" onClick={reset} disabled={busy}>
        {busy ? 'Resetting…' : 'Reset all progress'}
      </button>
    </div>
  )
}

export function Settings({ state, theme, setTheme, onSignOut }) {
  const [editing, setEditing] = useState(null)
  const categories = [...new Set(state.exercises.map((e) => e.category))].sort()
  const sorted = [...state.exercises].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
  )

  if (editing) {
    return (
      <div>
        <div className="section-head">
          <span>{editing === 'new' ? 'New exercise' : 'Edit exercise'}</span>
        </div>
        <ExerciseEditor
          exercise={editing === 'new' ? null : editing}
          categories={categories}
          onDone={() => setEditing(null)}
        />
      </div>
    )
  }

  return (
    <div>
      <div className="section-head">
        <span>Exercises</span>
        <button className="link" onClick={() => setEditing('new')}>
          Add
        </button>
      </div>

      {categories.map((category) => {
        const inCategory = sorted.filter((e) => e.category === category)
        return (
          <div key={category}>
            <div className="settings-category">{category}</div>
            {inCategory.map((e, i) => (
              <div className="row" key={e.id}>
                <span className="grow">{e.name}</span>
                <span className="muted">{e.cadence === 'daily' ? 'every day' : null}</span>
                <button
                  className="link link-icon"
                  aria-label="Move up"
                  disabled={i === 0}
                  onClick={() => {
                    const ids = moveWithinCategory(sorted, category, e.id, -1)
                    if (ids) actions.reorder(ids)
                  }}
                >
                  ▲
                </button>
                <button
                  className="link link-icon"
                  aria-label="Move down"
                  disabled={i === inCategory.length - 1}
                  onClick={() => {
                    const ids = moveWithinCategory(sorted, category, e.id, 1)
                    if (ids) actions.reorder(ids)
                  }}
                >
                  ▼
                </button>
                <button className="link" onClick={() => setEditing(e)}>
                  Edit
                </button>
                <button
                  className="link"
                  onClick={() => {
                    if (confirm(`Remove ${e.name}? Your history stays.`)) {
                      actions.archiveExercise(e.id)
                    }
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )
      })}

      <div className="section-head">
        <span>Tracking</span>
      </div>
      <div className="row">
        <span className="grow">Detailed entry</span>
        <DetailedEntryToggle enabled={state.detailedEntry} />
      </div>
      <p className="muted">
        Log reps and weight each time you tick off an exercise, instead of just marking it done.
      </p>

      <div className="section-head">
        <span>Appearance</span>
      </div>
      <div className="inline-actions">
        {THEMES.map(([value, label]) => (
          <button
            key={value}
            className="link"
            aria-pressed={theme === value}
            onClick={() => setTheme(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="section-head">
        <span>Password</span>
      </div>
      <PasswordForm />

      <div className="section-head">
        <span>Account</span>
      </div>
      <button className="btn" onClick={onSignOut}>
        Sign out
      </button>

      <div className="section-head">
        <span>Danger zone (temporary)</span>
      </div>
      <ResetProgressButton />
    </div>
  )
}
