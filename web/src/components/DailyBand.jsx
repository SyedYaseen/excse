import { lastDays, shortDate } from '../lib/dates.js'
import { TallyDot, TallyMark } from './TallyMark.jsx'

/**
 * Daily staples, pinned above the rotation on their own ground.
 *
 * Physical separation is the whole answer to "crunches shouldn't disappear
 * when I tick them": these never move, never leave, and clear themselves at
 * local midnight.
 *
 * The boundary used to be a pair of hairlines 3px apart, meant to encode
 * "above resets nightly, below persists". At phone density it read as one
 * thick line and communicated nothing. A tinted band with a label does the
 * same job in a way you do not have to be told about.
 */
export function DailyBand({ daily, logs, today, onToggle }) {
  if (daily.length === 0) return null

  const week = lastDays(today, 7)
  const loggedFor = (id) => new Set(logs.filter((l) => l.exerciseId === id).map((l) => l.day))
  const doneCount = daily.filter((e) => loggedFor(e.id).has(today)).length

  return (
    <section className="daily-band" aria-label="Every day">
      <h2 className="band-label">
        <span>Every day</span>
        <span className="num">
          {doneCount}/{daily.length}
        </span>
      </h2>

      {daily.map((e) => {
        const days = loggedFor(e.id)
        const done = days.has(today)
        return (
          <button
            className="daily-row"
            key={e.id}
            data-done={done}
            role="checkbox"
            aria-checked={done}
            aria-label={e.name}
            onClick={() => onToggle(e)}
          >
            <TallyMark checked={done} />
            <span className="daily-name">{e.name}</span>
            <span className="week" aria-hidden="true">
              {week.map((d) => (
                <TallyDot key={d} on={days.has(d)} title={shortDate(d)} />
              ))}
            </span>
          </button>
        )
      })}
    </section>
  )
}
