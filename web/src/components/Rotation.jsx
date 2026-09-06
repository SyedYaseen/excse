import { useState } from 'react'
import { formatSet } from './LogSetSheet.jsx'
import { matchesSearch } from '../lib/search.js'
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
function ExerciseRow({ exercise, todaySet, onToggle }) {
  const done = exercise.completedOn != null
  const label = todaySet && formatSet(todaySet)
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
      {label && <span className="set-detail muted num">{label}</span>}
      {!done && exercise.skipStreak > 0 && (
        <span className="skip-badge">{skipLabel(exercise.skipStreak)}</span>
      )}
    </button>
  )
}

// Search narrows which rows show without touching the counts in the
// heading -- those stay honest to real progress, not to what is on screen.
function visibleExercises(category, search) {
  if (!search) return category.exercises
  return category.exercises.filter((e) => matchesSearch(e.name, search))
}

function CategoryGroup({ category, focus, todaySets, search, onToggle }) {
  const exercises = visibleExercises(category, search)
  if (exercises.length === 0) return null

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
      {exercises.map((e) => (
        <ExerciseRow key={e.id} exercise={e} todaySet={todaySets.get(e.id)} onToggle={onToggle} />
      ))}
    </section>
  )
}

function CollapsedCategory({ category, todaySets, search, onToggle }) {
  const [open, setOpen] = useState(false)
  const exercises = visibleExercises(category, search)
  if (exercises.length === 0) return null

  // A search match hiding inside a collapsed, already-finished category
  // would otherwise need an extra tap just to see what matched.
  const expanded = search ? true : open

  return (
    <section className="category" id={categoryId(category.name)} data-settled="true">
      <button
        className="category-collapsed"
        aria-expanded={expanded}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="name">{category.name}</span>
        <span className="num">
          {category.done}/{category.total}
        </span>
      </button>
      {expanded &&
        exercises.map((e) => (
          <ExerciseRow key={e.id} exercise={e} todaySet={todaySets.get(e.id)} onToggle={onToggle} />
        ))}
    </section>
  )
}

/**
 * Only groups that were already finished at the last sort collapse into the
 * completed zone. One you finish *now* stays in place and reads as done, so
 * nothing ever moves under the thumb that just tapped it.
 */
export function Rotation({ categories, focus, logs, today, detailedEntry, search, onToggle }) {
  if (categories.length === 0) {
    return (
      <p className="empty">
        Add the exercises you can do at home. You'll tick them off as you go.
      </p>
    )
  }

  // Only ever today's own row: a repeat later in the cycle is what created
  // this occurrence, an earlier completion's detail is not "now".
  const todaySets = detailedEntry
    ? new Map(logs.filter((l) => l.day === today).map((l) => [l.exerciseId, l]))
    : new Map()

  const open = categories.filter((c) => !c.settled)
  const settled = categories.filter((c) => c.settled)
  const settledVisible = settled.some((c) => visibleExercises(c, search).length > 0)

  return (
    <>
      {open.map((c) => (
        <CategoryGroup
          key={c.name}
          category={c}
          focus={c.name === focus}
          todaySets={todaySets}
          search={search}
          onToggle={onToggle}
        />
      ))}

      {settledVisible && (
        <div className="completed-zone">
          <p className="completed-label">Done this cycle</p>
          {settled.map((c) => (
            <CollapsedCategory
              key={c.name}
              category={c}
              todaySets={todaySets}
              search={search}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </>
  )
}
