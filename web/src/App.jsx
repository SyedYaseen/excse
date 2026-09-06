import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { today as todayISO } from './lib/dates.js'
import {
  applyOrder,
  cycleProgress,
  freezeOrder,
  loggedOn,
  organise,
  suggestNext,
} from './lib/sort.js'
import { actions, clearLocal, getSnapshot, subscribe } from './lib/store.js'
import { flush, refresh, startAutoSync } from './lib/sync.js'
import { matchesSearch } from './lib/search.js'
import { api } from './lib/api.js'
import { DailyBand } from './components/DailyBand.jsx'
import { categoryId, Rotation } from './components/Rotation.jsx'
import { CycleButton } from './components/CycleButton.jsx'
import { History } from './components/History.jsx'
import { Login } from './components/Login.jsx'
import { LogSetSheet } from './components/LogSetSheet.jsx'
import { Settings } from './components/Settings.jsx'

const THEME_KEY = 'exse.theme'

// The count owns the top of the screen on Today. On the other tabs it would
// otherwise sit empty, so the view name takes the slot instead.
const TITLES = { history: 'History', settings: 'Settings' }

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || 'system')

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
    localStorage.setItem(THEME_KEY, theme)

    // Keep the browser chrome in step with the page.
    const dark =
      theme === 'dark' ||
      (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', dark ? '#14171A' : '#E8EAE6')
  }, [theme])

  return [theme, setTheme]
}

/**
 * "Today" has to keep up with the clock while the app sits open, or a daily
 * ticked at 23:55 still reads as done at 00:05.
 */
function useToday() {
  const [day, setDay] = useState(todayISO)

  useEffect(() => {
    const check = () => setDay(todayISO())
    const id = setInterval(check, 60_000)
    document.addEventListener('visibilitychange', check)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', check)
    }
  }, [])

  return day
}

export default function App() {
  const { state, status } = useSyncExternalStore(subscribe, getSnapshot)
  const [theme, setTheme] = useTheme()
  const [view, setView] = useState('today')
  const today = useToday()

  const [booted, setBooted] = useState(false)
  const [resortNonce, setResortNonce] = useState(0)
  const orderRef = useRef({ key: null, order: null })
  const [logging, setLogging] = useState(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    const stop = startAutoSync()
    refresh().finally(() => setBooted(true))
    return stop
  }, [])

  // Cached state renders immediately; a cold start waits for the first refresh
  // rather than flashing the login screen at someone who is already signed in.
  if (!state && !booted) return <main className="app" />
  if (status.authed === false || !state) return <Login onSignedIn={refresh} />

  const live = organise(state.exercises, state.logs, today)
  const progress = cycleProgress(state.exercises)
  const doneToday = loggedOn(state.logs, today)

  // The ordering rules run when you ask, not after every tick. Re-sorting
  // under a thumb mid-set moved the next row into the space the last one
  // vacated -- a double-tap waiting to happen, and it lost your place in the
  // muscle group you were working through. The snapshot is retaken on a new
  // day, on a new cycle, and on Re-sort; between those, nothing moves.
  const orderKey = `${today}:${state.cycle.id}:${resortNonce}`
  if (orderRef.current.key !== orderKey) {
    orderRef.current = { key: orderKey, order: freezeOrder(live) }
  }
  const { daily, categories } = applyOrder(live, orderRef.current.order)

  // Read live, so it keeps pointing at the least-worked unfinished group
  // without anything changing position. Naming it is free; moving it is not.
  const focus = suggestNext(live)

  function jumpToFocus() {
    const el = focus && document.getElementById(categoryId(focus))
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function toggle(exercise) {
    // Untick only ever retracts today's own mark. An exercise completed
    // earlier in the cycle is logged again instead, so a repeat still counts
    // as a day exercised -- see docs/DECISIONS.md.
    const loggedToday = doneToday.has(exercise.id)

    // Detailed mode trades the one-tap gesture for a sheet, both for a fresh
    // log and for revisiting today's own numbers -- there is no separate
    // "edit" control, so tapping a done row while pending isn't lost either
    // way. Off, the tap stays instant.
    if (state.detailedEntry) {
      setLogging({ exercise, wasLogged: loggedToday })
      return
    }

    if (loggedToday) actions.untick(exercise.id, today)
    else {
      actions.tick(exercise.id, today)
      navigator.vibrate?.(10)
    }
  }

  function saveLog(detail) {
    actions.tick(logging.exercise.id, today, detail)
    if (!logging.wasLogged) navigator.vibrate?.(10)
    setLogging(null)
  }

  function removeLog() {
    actions.untick(logging.exercise.id, today)
    setLogging(null)
  }

  async function signOut() {
    try {
      await api.logout()
    } catch {
      // Signing out locally is the part that matters.
    }
    clearLocal()
    location.reload()
  }

  const skipped = state.exercises.filter(
    (e) => e.cadence === 'cycle' && e.completedOn == null,
  )
  const left = progress.total - progress.done

  const searching = search.trim() !== ''
  const noMatches = searching && !state.exercises.some((e) => matchesSearch(e.name, search))

  return (
    <>
      <main className="app">
        <header className="progress">
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{
                width: progress.total ? `${(progress.done / progress.total) * 100}%` : '0%',
              }}
            />
          </div>
        </header>

        <div className="hero">
          <div className="progress-meta">
            <p className="hero-count num">
              {view !== 'today' ? (
                <strong>{TITLES[view]}</strong>
              ) : progress.complete ? (
                <strong>all done</strong>
              ) : (
                <>
                  <strong>{left}</strong> left
                </>
              )}
            </p>
            <p className="hero-sub">
              Cycle {state.cycle.seq}
              {status.pending > 0 && <span className="unsynced">Not saved yet</span>}
            </p>
          </div>

          {view === 'today' && (
            <div className="hero-actions">
              {focus && (
                <button className="jump" onClick={jumpToFocus}>
                  Next up: {focus}
                </button>
              )}
              <button onClick={() => setResortNonce((n) => n + 1)}>Re-sort</button>
            </div>
          )}
        </div>

        {view === 'today' && (
          <>
            <input
              type="search"
              className="search-field"
              placeholder="Search exercises"
              aria-label="Search exercises"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            {noMatches ? (
              <p className="empty">No exercises match "{search.trim()}".</p>
            ) : (
              <>
                <DailyBand
                  daily={daily}
                  logs={state.logs}
                  today={today}
                  detailedEntry={state.detailedEntry}
                  search={search}
                  onToggle={toggle}
                />
                <Rotation
                  categories={categories}
                  focus={focus}
                  logs={state.logs}
                  today={today}
                  detailedEntry={state.detailedEntry}
                  search={search}
                  onToggle={toggle}
                />
              </>
            )}
            <CycleButton
              progress={progress}
              skipped={skipped}
              nextSeq={state.cycle.seq + 1}
              onEnd={() => {
                actions.endCycle(today)
                flush()
              }}
            />
          </>
        )}

        {view === 'history' && <History state={state} today={today} />}

        {view === 'settings' && (
          <Settings
            state={state}
            theme={theme}
            setTheme={setTheme}
            onSignOut={signOut}
          />
        )}
        {logging && (
          <LogSetSheet
            exercise={logging.exercise}
            initial={state.logs.find(
              (l) => l.exerciseId === logging.exercise.id && l.day === today,
            )}
            wasLogged={logging.wasLogged}
            onSave={saveLog}
            onRemove={removeLog}
            onCancel={() => setLogging(null)}
          />
        )}
      </main>

      <nav className="nav">
        {[
          ['today', 'Today'],
          ['history', 'History'],
          ['settings', 'Settings'],
        ].map(([key, label]) => (
          <button
            key={key}
            aria-current={view === key ? 'page' : undefined}
            onClick={() => setView(key)}
          >
            {label}
          </button>
        ))}
      </nav>
    </>
  )
}
