import { useState } from 'react'
import { api } from '../lib/api.js'
import { actions } from '../lib/store.js'

const THEMES = [
  ['system', 'System'],
  ['light', 'Light'],
  ['dark', 'Dark'],
]

function ExerciseEditor({ exercise, categories, onDone }) {
  const [name, setName] = useState(exercise?.name ?? '')
  const [category, setCategory] = useState(exercise?.category ?? categories[0] ?? 'Core')
  const [cadence, setCadence] = useState(exercise?.cadence ?? 'cycle')

  function save(e) {
    e.preventDefault()
    if (!name.trim()) return
    actions.upsertExercise({
      id: exercise?.id ?? crypto.randomUUID(),
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
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          list="exse-categories"
        />
        <datalist id="exse-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
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

export function Settings({ state, theme, setTheme, onSignOut }) {
  const [editing, setEditing] = useState(null)
  const categories = [...new Set(state.exercises.map((e) => e.category))].sort()

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

      {state.exercises.map((e) => (
        <div className="row" key={e.id}>
          <span className="grow">{e.name}</span>
          <span className="muted">
            {e.cadence === 'daily' ? 'every day' : e.category}
          </span>
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
    </div>
  )
}
