import { lastDays, shortDate } from '../lib/dates.js'
import { TallyDot, TallyMark } from './TallyMark.jsx'

/**
 * Daily staples, pinned above the rotation and separated by a double rule.
 *
 * Physical separation is the whole answer to "crunches shouldn't disappear
 * when I tick them": these never move, never leave, and clear themselves at
 * local midnight. Nothing has to be explained.
 */
export function DailyBand({ daily, logs, today, onToggle }) {
  if (daily.length === 0) return null

  const week = lastDays(today, 7)
  const loggedFor = (id) => new Set(logs.filter((l) => l.exerciseId === id).map((l) => l.day))

  return (
    <section aria-label="Every day">
      {daily.map((e) => {
        const days = loggedFor(e.id)
        const done = days.has(today)
        return (
          <div className="daily-row" key={e.id} data-done={done}>
            <TallyMark checked={done} onChange={() => onToggle(e)} label={e.name} />
            <span className="daily-name">{e.name}</span>
            <span className="week" aria-hidden="true">
              {week.map((d) => (
                <TallyDot key={d} on={days.has(d)} title={shortDate(d)} />
              ))}
            </span>
          </div>
        )
      })}
      <div className="band-end" role="separator" />
    </section>
  )
}
