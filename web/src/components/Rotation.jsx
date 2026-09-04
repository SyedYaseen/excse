import { useState } from 'react'
import { TallyMark } from './TallyMark.jsx'

function skipLabel(n) {
  if (n === 1) return 'skipped once'
  if (n === 2) return 'skipped twice'
  return `skipped ${n} cycles`
}

function ExerciseRow({ exercise, onToggle }) {
  const done = exercise.completedOn != null
  return (
    <div className="exercise" data-done={done}>
      <TallyMark
        checked={done}
        onChange={() => onToggle(exercise)}
        label={exercise.name}
      />
      <span className="exercise-name">{exercise.name}</span>
      {!done && exercise.skipStreak > 0 && (
        <span className="skip-badge">{skipLabel(exercise.skipStreak)}</span>
      )}
    </div>
  )
}

function CategoryGroup({ category, onToggle }) {
  return (
    <section className="category">
      <h2 className="category-head">
        <span>{category.name}</span>
        <span className="category-count num">
          {category.done}/{category.total}
        </span>
      </h2>
      {category.exercises.map((e) => (
        <ExerciseRow key={e.id} exercise={e} onToggle={onToggle} />
      ))}
    </section>
  )
}

function CollapsedCategory({ category, onToggle }) {
  const [open, setOpen] = useState(false)
  return (
    <section className="category">
      <button
        className="category-collapsed"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="name">{category.name}</span>
        <span className="num">
          {category.done}/{category.total}
        </span>
      </button>
      {open &&
        category.exercises.map((e) => (
          <ExerciseRow key={e.id} exercise={e} onToggle={onToggle} />
        ))}
    </section>
  )
}

export function Rotation({ categories, onToggle }) {
  const open = categories.filter((c) => !c.complete)
  const complete = categories.filter((c) => c.complete)

  if (categories.length === 0) {
    return (
      <p className="empty">
        Add the exercises you can do at home. You'll tick them off as you go.
      </p>
    )
  }

  return (
    <>
      {open.map((c) => (
        <CategoryGroup key={c.name} category={c} onToggle={onToggle} />
      ))}

      {complete.length > 0 && (
        <div className="completed-zone">
          {complete.map((c) => (
            <CollapsedCategory key={c.name} category={c} onToggle={onToggle} />
          ))}
        </div>
      )}
    </>
  )
}
