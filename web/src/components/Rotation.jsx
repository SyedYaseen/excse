import { useState } from 'react'
import { TallyMark } from './TallyMark.jsx'

function skipLabel(n) {
  if (n === 1) return 'skipped once'
  if (n === 2) return 'skipped twice'
  return `skipped ${n} cycles`
}

/** Stable anchor so the hero's "next up" control can scroll to a group. */
export const categoryId = (name) => `group-${name.replace(/\W+/g, '-').toLowerCase()}`

/**
 * The whole row is the control. Tapping the name strikes it out exactly like
 * tapping the tally, which is the gesture people reach for first -- aiming a
 * thumb at a 22px glyph mid-set is not.
 */
function ExerciseRow({ exercise, onToggle }) {
  const done = exercise.completedOn != null
  return (
    <button
      className="exercise"
      data-done={done}
      role="checkbox"
      aria-checked={done}
      aria-label={exercise.name}
      onClick={() => onToggle(exercise)}
    >
      <TallyMark checked={done} />
      <span className="exercise-name">{exercise.name}</span>
      {!done && exercise.skipStreak > 0 && (
        <span className="skip-badge">{skipLabel(exercise.skipStreak)}</span>
      )}
    </button>
  )
}

function CategoryGroup({ category, focus, onToggle }) {
  return (
    <section
      className="category"
      id={categoryId(category.name)}
      data-focus={focus}
      data-complete={category.complete}
      data-settled="false"
    >
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
    <section className="category" id={categoryId(category.name)} data-settled="true">
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

/**
 * Only groups that were already finished at the last sort collapse into the
 * completed zone. One you finish *now* stays in place and reads as done, so
 * nothing ever moves under the thumb that just tapped it.
 */
export function Rotation({ categories, focus, onToggle }) {
  if (categories.length === 0) {
    return (
      <p className="empty">
        Add the exercises you can do at home. You'll tick them off as you go.
      </p>
    )
  }

  const open = categories.filter((c) => !c.settled)
  const settled = categories.filter((c) => c.settled)

  return (
    <>
      {open.map((c) => (
        <CategoryGroup
          key={c.name}
          category={c}
          focus={c.name === focus}
          onToggle={onToggle}
        />
      ))}

      {settled.length > 0 && (
        <div className="completed-zone">
          <p className="completed-label">Done this cycle</p>
          {settled.map((c) => (
            <CollapsedCategory key={c.name} category={c} onToggle={onToggle} />
          ))}
        </div>
      )}
    </>
  )
}
