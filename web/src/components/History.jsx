import { useEffect, useRef, useState } from 'react'
import { addDays, fromISO, shortDate, toISO } from '../lib/dates.js'
import { longestStreak, streak } from '../lib/sort.js'
import { TallyDot } from './TallyMark.jsx'

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

function Month({ activeDays, today }) {
  const [offset, setOffset] = useState(0)
  const active = new Set(activeDays)

  const base = fromISO(today)
  const view = new Date(base.getFullYear(), base.getMonth() + offset, 1)
  const year = view.getFullYear()
  const month = view.getMonth()

  // Monday-first, so the leading blanks are Sunday-shifted.
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))

  const title = view.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  return (
    <>
      <div className="section-head">
        <span>{title}</span>
        <span className="month-nav">
          <button onClick={() => setOffset((o) => o - 1)} aria-label="Previous month">
            &lt;
          </button>
          <button
            onClick={() => setOffset(0)}
            disabled={offset === 0}
            className="muted"
          >
            Today
          </button>
          <button onClick={() => setOffset((o) => o + 1)} aria-label="Next month">
            &gt;
          </button>
        </span>
      </div>

      <div className="month">
        {WEEKDAYS.map((d, i) => (
          <div className="month-label" key={i}>
            {d}
          </div>
        ))}
        {cells.map((date, i) => {
          if (!date) return <div key={`b${i}`} />
          const iso = toISO(date)
          return (
            <div
              className="day num"
              key={iso}
              data-active={active.has(iso)}
              data-today={iso === today}
              title={active.has(iso) ? `Exercised ${shortDate(iso)}` : shortDate(iso)}
            >
              {active.has(iso) ? <TallyDot on /> : date.getDate()}
            </div>
          )
        })}
      </div>
    </>
  )
}

/**
 * The year as 52 columns of 7 marks -- a wall of what you have accumulated.
 * This is the payoff for keeping active_days forever, so it gets the strongest
 * image in the app rather than a generic heatmap.
 */
function Year({ activeDays, today }) {
  const active = new Set(activeDays)
  const weeks = []

  // Walk back to the most recent Monday, then 52 weeks before that.
  const todayDow = (fromISO(today).getDay() + 6) % 7
  let cursor = addDays(today, -todayDow - 51 * 7)

  for (let w = 0; w < 52; w++) {
    const days = []
    for (let d = 0; d < 7; d++) {
      days.push(cursor)
      cursor = addDays(cursor, 1)
    }
    weeks.push(days)
  }

  // 52 columns need ~670px and a phone gives ~360, so the grid scrolls. It
  // must open on the right-hand end: the left end is the oldest weeks, which
  // on any history shorter than a year is a wall of nothing. Opening at
  // scrollLeft 0 hid ~85% of the marks behind an empty grid.
  const scroller = useRef(null)
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [activeDays, today])

  return (
    <div
      className="year"
      ref={scroller}
      role="img"
      aria-label={`${activeDays.length} days exercised`}
    >
      {weeks.map((days) => (
        <div className="year-week" key={days[0]}>
          {days.map((d) => (
            <TallyDot key={d} on={active.has(d)} title={shortDate(d)} />
          ))}
        </div>
      ))}
    </div>
  )
}

function CycleHistory({ cycles }) {
  if (cycles.length === 0) return null
  return (
    <>
      <div className="section-head">
        <span>Cycles</span>
      </div>
      {cycles.map((c) => (
        <div className="cycle-history" key={c.id}>
          <span>Cycle {c.seq}</span>
          <span className="detail num">
            {c.doneCount}/{c.totalCount}
            {c.endedEarly ? ' — ended early' : ''}
          </span>
        </div>
      ))}
    </>
  )
}

export function History({ state, today }) {
  const days = state.activeDays
  const current = streak(days, today)
  const best = longestStreak(days)

  return (
    <div>
      <div className="stats">
        <div>
          <div className="stat-value num">{current}</div>
          <div className="stat-label">day streak</div>
        </div>
        <div>
          <div className="stat-value num">{best}</div>
          <div className="stat-label">best run</div>
        </div>
        <div>
          <div className="stat-value num">{days.length}</div>
          <div className="stat-label">days total</div>
        </div>
      </div>

      <Month activeDays={days} today={today} />

      <div className="section-head">
        <span>The last year</span>
      </div>
      <Year activeDays={days} today={today} />

      <p className="muted">
        Which exercises you did is kept for {state.retentionDays} days. That you
        exercised at all is kept for good.
      </p>

      <CycleHistory cycles={state.pastCycles} />
    </div>
  )
}
