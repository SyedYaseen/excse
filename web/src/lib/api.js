export class AuthError extends Error {}
export class OfflineError extends Error {}

async function request(method, url, body) {
  let res
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    // Network-level failure. The caller keeps its outbox and tries later.
    throw new OfflineError('unreachable')
  }

  // Never treated as "the server says you have no data": local state and the
  // outbox survive, the user signs in again, and the outbox then flushes.
  if (res.status === 401) throw new AuthError('signed out')

  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error ?? 'Something went wrong.')
  return data
}

export const api = {
  me: () => request('GET', '/api/me'),
  login: (username, password) => request('POST', '/api/login', { username, password }),
  signup: (email, password) => request('POST', '/api/signup', { email, password }),
  logout: () => request('POST', '/api/logout'),
  changePassword: (current, next) => request('POST', '/api/password', { current, next }),
  setDetailedEntry: (detailedEntry) => request('POST', '/api/settings', { detailedEntry }),
  state: () => request('GET', '/api/state'),
  sync: (ops) => request('POST', '/api/sync', { ops }),
  // TEMP: remove with the Settings reset button once asked.
  resetProgress: () => request('POST', '/api/reset-progress'),
}
