# e2e

Playwright tests for the things the Rust and JS unit suites cannot reach: what
the screen actually looks like, and what happens across a real browser's
network, storage and clock.

Kept out of `web/` deliberately — `web/package.json` has four direct
dependencies and `docs/DECISIONS.md` treats that as load-bearing. Nothing here
is in the runtime image.

## Running

The tests drive a **running server and a real database**; they do not start
either. Bring the app up first (see `docs/HANDOFF.md`), then:

```sh
npm install
npx playwright install chromium
npm test                  # both themes
npm test -- --project=light
npm run screens           # writes screens/*.png for visual review
npm run report
```

Configuration, all optional:

| Variable | Default |
|---|---|
| `EXSE_URL` | `http://127.0.0.1:3005` |
| `EXSE_PASSWORD` | `testpass123` |
| `DAY_MIN_EXERCISES` | `4` — must match the server's |
| `DATABASE_URL` | `postgres://exse:exse@127.0.0.1:5432/exse` |

`DATABASE_URL` is used by `psql` for two things the API deliberately does not
expose: resetting to a clean cycle 1 between tests, and asserting on rows the
UI never shows. `psql` must be on `PATH`.

`resetState()` **deletes** every log, active day and cycle. Point this at a
throwaway database, never at the one your phone syncs to:

```sh
createdb exse_e2e
DATABASE_URL=postgres://exse:exse@127.0.0.1:5432/exse_e2e \
  ADMIN_INITIAL_PASSWORD=testpass123 PORT=3006 cargo run &
EXSE_URL=http://127.0.0.1:3006 \
  DATABASE_URL=postgres://exse:exse@127.0.0.1:5432/exse_e2e npm test
```

Running `cargo test` needs the database role to have `CREATEDB`, since
`#[sqlx::test]` builds a throwaway database per test:

```sh
psql -c 'ALTER ROLE exse CREATEDB;'
```

## Shape

Every project is a phone viewport (iPhone 14, 390pt) — there is no desktop
layout to regress. The only axis that varies is the theme, so each spec runs
once in light and once in dark.

Tests share one user and one database, so they run serially and each starts by
resetting cycle state through `resetState()` in `fixtures.js`.

**Ticking no longer moves anything** — the order is frozen until you open the
app again, start a new cycle, or press `Re-sort`. Ending a cycle and `Re-sort`
*do* reorder, so still pin by exercise name rather than position, exactly
(several catalogue names are substrings of others).

**Counts come from the database, not from literals.** `rotationCount()` and
`exerciseCount()` in `fixtures.js` read them, because the catalogue is the
user's own list and a test asserting "16 left" is really asserting the seed.

| Spec | Covers |
|---|---|
| `smoke` | sign-in, console errors, touch targets, horizontal overflow |
| `cycle` | B1–B4, B7, B8, A6 — completing, ending early, skip debt, repeat vs untick, what earns a day, marking one by hand |
| `resilience` | C1–C3 — offline outbox, the sync race, 401 handling |
| `settings` | B6 — add, edit, cadence change, soft delete, password change |
| `rollover` | B5 — local midnight, via Playwright's clock |
| `a11y` | D1–D3 — keyboard, the year view's single label, reduced motion |
| `layout` | touch targets, the year view's scroll position, contrast, the daily band, and A7 — that ticking moves nothing |
| `screens` | not assertions — writes the images a human reviews |

`C4` (the session surviving a restart) is not here: it needs to restart the
server, which the suite does not own. Check it by hand with a cookie jar.
