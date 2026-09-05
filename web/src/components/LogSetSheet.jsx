import { useState } from 'react'

/**
 * The entry sheet for detailed mode. Replaces the instant tap-to-tick while
 * `detailedEntry` is on -- see docs/DECISIONS.md. Both fields are optional:
 * plenty of exercises here (planks, dead hangs) don't have a rep count or a
 * plate to name.
 *
 * `wasLogged` decides whether `Remove` shows. It reuses `tick`'s own
 * coalesce-on-conflict semantics for editing: saving again for the same day
 * just updates the row in place, it never creates a second one.
 */
export function LogSetSheet({ exercise, initial, wasLogged, onSave, onRemove, onCancel }) {
  const [reps, setReps] = useState(initial?.reps != null ? String(initial.reps) : '')
  const [weight, setWeight] = useState(initial?.weight != null ? String(initial.weight) : '')

  function submit(e) {
    e.preventDefault()
    onSave({
      reps: reps.trim() === '' ? null : Number(reps),
      weight: weight.trim() === '' ? null : Number(weight),
    })
  }

  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Log ${exercise.name}`}
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="sheet">
        <h2>{exercise.name}</h2>
        <form onSubmit={submit}>
          <label className="field">
            <span>Reps</span>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              value={reps}
              onChange={(e) => setReps(e.target.value)}
              autoFocus
            />
          </label>
          <label className="field">
            <span>Weight</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.5"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
          </label>
          <div className="sheet-actions">
            <button className="btn btn-primary">{wasLogged ? 'Save' : 'Log it'}</button>
            {wasLogged && (
              <button type="button" className="btn btn-danger" onClick={onRemove}>
                Remove
              </button>
            )}
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/** "12 x 135" / "12 reps" / "135 lb" -- whichever half was actually filled in. */
export function formatSet({ reps, weight }) {
  if (reps != null && weight != null) return `${reps} × ${weight}`
  if (reps != null) return `${reps} reps`
  if (weight != null) return `${weight}`
  return null
}
