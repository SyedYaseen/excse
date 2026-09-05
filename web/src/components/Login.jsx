import { useState } from 'react'
import { api } from '../lib/api.js'

export function Login({ onSignedIn }) {
  const [mode, setMode] = useState('signin')
  const [username, setUsername] = useState('admin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const signingUp = mode === 'signup'

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (signingUp) {
        await api.signup(email, password)
      } else {
        await api.login(username, password)
      }
      onSignedIn()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  function toggleMode() {
    setMode(signingUp ? 'signin' : 'signup')
    setError(null)
    setPassword('')
  }

  return (
    <form className="login" onSubmit={submit}>
      <h1>exse</h1>
      {error && <p className="error">{error}</p>}
      {signingUp ? (
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
          />
        </label>
      ) : (
        <label className="field">
          <span>Username</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
          />
        </label>
      )}
      <label className="field">
        <span>Password</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={signingUp ? 'new-password' : 'current-password'}
        />
      </label>
      <button className="btn btn-primary" disabled={busy}>
        {busy ? (signingUp ? 'Creating account' : 'Signing in') : signingUp ? 'Sign up' : 'Sign in'}
      </button>
      <button type="button" className="btn btn-link" onClick={toggleMode} disabled={busy}>
        {signingUp ? 'Have an account? Sign in' : "Don't have an account? Sign up"}
      </button>
    </form>
  )
}
