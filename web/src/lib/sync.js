import { api, AuthError, OfflineError } from './api.js'
import {
  dropSentOps,
  getOutbox,
  replayOutbox,
  setOnDispatch,
  setServerState,
  setStatus,
} from './store.js'

let flushing = false
let timer = null

/**
 * Drains the outbox, then adopts the server's state.
 *
 * The snapshot-and-drop-n dance matters: anything ticked during the round trip
 * is appended to the outbox while the request is in flight, so clearing the
 * whole outbox on success would silently swallow it. We remove exactly the ops
 * we sent and replay the rest on top of the response.
 */
export async function flush() {
  const outbox = getOutbox()
  if (flushing || outbox.length === 0) return
  flushing = true
  setStatus({ syncing: true, error: null })

  const batch = outbox.slice()
  try {
    const server = await api.sync(batch)
    dropSentOps(batch.length)
    setServerState(server)
    replayOutbox()
    setStatus({ syncing: false, authed: true, error: null })
  } catch (err) {
    if (err instanceof AuthError) {
      // Keep everything. The user signs back in and this flushes then.
      setStatus({ syncing: false, authed: false })
    } else if (err instanceof OfflineError) {
      setStatus({ syncing: false, error: null })
    } else {
      setStatus({ syncing: false, error: err.message })
    }
  } finally {
    flushing = false
  }
}

/** Pulls fresh state, then replays anything still queued on top of it. */
export async function refresh() {
  try {
    const server = await api.state()
    setServerState(server)
    replayOutbox()
    setStatus({ authed: true, error: null })
    await flush()
  } catch (err) {
    if (err instanceof AuthError) setStatus({ authed: false })
    else if (!(err instanceof OfflineError)) setStatus({ error: err.message })
  }
}

export function scheduleFlush(ms = 2000) {
  clearTimeout(timer)
  timer = setTimeout(flush, ms)
}

export function startAutoSync() {
  const onVisible = () => {
    if (document.visibilityState === 'visible') flush()
  }
  setOnDispatch(() => scheduleFlush())
  window.addEventListener('online', flush)
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    setOnDispatch(() => {})
    window.removeEventListener('online', flush)
    document.removeEventListener('visibilitychange', onVisible)
    clearTimeout(timer)
  }
}
