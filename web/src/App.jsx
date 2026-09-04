import { useEffect, useState, useSyncExternalStore } from 'react'
import { today as todayISO } from './lib/dates.js'
import { cycleProgress, isDone, loggedOn, organise } from './lib/sort.js'
import { actions, clearLocal, getSnapshot, subscribe } from './lib/store.js'
import { flush, refresh, startAutoSync } from './lib/sync.js'
import { api } from './lib/api.js'
import { DailyBand } from './components/DailyBand.jsx'
import { Rotation } from './components/Rotation.jsx'
import { CycleButton } from './components/CycleButton.jsx'
import { History } from './components/History.jsx'
import { Login } from './components/Login.jsx'
import { Settings } from './components/Settings.jsx'

const THEME_KEY = 'exse.theme'

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

  useEffect(() => {
    const stop = startAutoSync()
    refresh().finally(() => setBooted(true))
    return stop
  }, [])

  // Cached state renders immediately; a cold start waits for the first refresh
  // rather than flashing the login screen at someone who is already signed in.
  if (!state && !booted) return <main className="app" />
  if (status.authed === false || !state) return <Login onSignedIn={refresh} />

  const { daily, categories } = organise(state.exercises, state.logs, today)
  const progress = cycleProgress(state.exercises)
  const doneToday = loggedOn(state.logs, today)

  function toggle(exercise) {
    // Untick only ever retracts today's own mark. An exercise completed
    // earlier in the cycle is logged again instead, so a repeat still counts
    // as a day exercised -- see docs/DECISIONS.md.
    const loggedToday = doneToday.has(exercise.id)
    if (loggedToday) actions.untick(exercise.id, today)
    else {
      actions.tick(exercise.id, today)
      navigator.vibrate?.(10)
    }
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
          <div className="progress-meta">
            <span>
              <strong>Cycle {state.cycle.seq}</strong>
            </span>
            <span className="num">
              {status.pending > 0 && <span className="unsynced">Not saved yet </span>}
              {view === 'today' && (progress.complete ? 'all done' : `${left} left`)}
            </span>
          </div>
        </header>

        {view === 'today' && (
          <>
            <DailyBand daily={daily} logs={state.logs} today={today} onToggle={toggle} />
            <Rotation categories={categories} onToggle={toggle} />
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
