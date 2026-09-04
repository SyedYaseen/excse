# Handoff — browser testing

The app was built and verified entirely through its API and its test suites. **Nobody
has ever looked at it.** The host it runs on has no browser, so every claim in
`docs/DESIGN.md` about how this thing looks is, at present, a claim about the code rather
than an observation about the screen.

This document exists so a session on a machine that *does* have a browser can close that
gap. It is written to be picked up cold — you should not need anything from the
conversation that produced the code.

What is already known to pass, and does not need re-testing: 19 Rust integration tests
(`cargo test`) covering the data rules, and 31 JS unit tests (`npm --prefix web test`)
covering the sort order and the store reducer. Run them once to confirm the checkout is
sound; don't re-derive what they cover.

---

## 1. Get the app in front of a browser

### Path A — same LAN as the server (preferred)

The server is already running. Open:

```
http://192.168.1.18:3005
```

Nothing to build, nothing to install, and you are testing the real artifact. If the page
does not load, you are on a different network — use Path B.

### Path B — run it on the test machine

Needs Docker and Rust. This brings up a throwaway Postgres rather than touching the
one on the home server:

```sh
git clone git@github.com:SyedYaseen/excse.git exse && cd exse

docker run -d --name exse-pg -p 5432:5432 \
  -e POSTGRES_USER=exse -e POSTGRES_PASSWORD=exse -e POSTGRES_DB=exse \
  postgres:15-alpine

cp .env.example .env
# then edit .env:
#   DATABASE_URL=postgres://exse:exse@127.0.0.1:5432/exse
#   COOKIE_SECRET=$(openssl rand -hex 64)
#   ADMIN_INITIAL_PASSWORD=<anything>

npm --prefix web install
npm --prefix web run build     # writes ./dist, which the Rust server serves
cargo run                      # migrates, bootstraps, listens on :3005
```

Then `http://127.0.0.1:3005`. Migrations and the first-run bootstrap (admin + 18 starter
exercises + cycle 1) happen automatically on an empty database.

For UI work specifically, `npm --prefix web run dev` alongside `cargo run` gives hot
reload; Vite proxies `/api` to `:3005`, so both must be up.

### Credentials

`admin`, with the password from `ADMIN_INITIAL_PASSWORD`. On the home server that value
is in `/home/poochi/projects/exse/.env`, which is gitignored and **not** in this repo —
carry it across yourself. On Path B it is whatever you just set.

---

## 2. What to test

Ordered by value. Group A is the reason this handoff exists; if you only get through
Group A, that is still a good session.

### Group A — visual review

Everything here is a judgement call, which is exactly why it could not be automated.
`docs/DESIGN.md` is the intent; your job is to report where the screen departs from it,
and where the intent itself turns out to be wrong once visible.

**A1. Phone viewport, both themes.**
DevTools device emulation at 390×844 (iPhone 14). Visit all three tabs — Today, History,
Settings — in light, then dark (Settings has a system/light/dark switch). Screenshot each;
six images total.

Look for: text that wraps badly or truncates, touch targets that look under ~44px, the
type scale reading too large or too small at arm's length, contrast that fails in one
theme but not the other, and any element that has drifted into looking like a generic
card-based SaaS dashboard — which `docs/DESIGN.md` explicitly rules out.

**A2. The tally mark.**
The single most load-bearing visual decision: the tick is a vertical stroke `│` that gains
a diagonal slash `╱` when done, plus a strike-through on the name. Tick a few exercises.

Does the slash actually read as a tally mark at phone size, or as a smudge? Is the
difference between marked and unmarked obvious at a glance without reading the text?
Does the ~140ms stroke animation land, or is it too fast to notice / slow enough to annoy
mid-workout? This is the one place the design spends boldness — if it does not work,
say so plainly, it is better to know now.

**A3. The double rule.**
The daily band (Crunches, Plank) sits above a double rule; the rotation sits below it.
The rule is meant to carry the meaning "above resets nightly, below persists" without a
label. Does it read as structural, or as decoration? Would a person who had never been
told notice a boundary at all?

**A4. The year view.**
History → "The last year": 52 columns of 7 marks. On a fresh database this is almost
entirely empty, which is itself worth seeing — an empty grid may look broken rather than
new. To judge it with real data, seed some history (Group D below) and look again.
Check it does not overflow the viewport horizontally at 390px.

**A5. Progress rule and header.**
The 2px full-width rule at the top is both the app's only chrome and its only statistic.
Confirm it fills proportionally as exercises are ticked, and that "Cycle 3 / 11 left"
stays legible against it.

**A6. Category collapse.**
Complete every exercise in one category. It should collapse to a single struck-through
line and sink below a hairline, leaving only actionable items above. Verify the collapse
is legible rather than a jump, and that the collapsed line still says which category it
was and that it is finished.

### Group B — behaviour that needs a real browser

**B1. Full cycle, end normally.**
Tick all 16 cycle exercises. The button should become a full-width primary
`Start cycle 2`. Press it. Expect: all cycle marks cleared, `Cycle 2` in the header,
daily exercises unaffected, and History → Cycles showing `Cycle 1 — 16/16` with no
"ended early" note.

**B2. End a cycle early.**
In cycle 2, tick a handful and press `End cycle early`. A sheet should name exactly what
gets skipped, in the form *"Superman, Bird dog and 3 more will carry to the top of your
next cycle."* Confirm.

Then check the top of cycle 3: the skipped exercises should be first, badged `skipped
once`. Repeat the early end without doing them and the badge should read `skipped twice`.
Complete one and its badge should clear on the following cycle. This is the feature that
was asked for specifically — that ending early is a real, recorded thing rather than a
failure state — so it is worth being thorough here.

**B3. Repeat vs untick.**
Tap a cycle exercise you completed **today** → it unticks. Tap one completed **earlier in
the same cycle** → it must *not* untick; it logs today as a repeat. The header count
should not change, but today should now show as exercised in History. Getting this
backwards is the sort of bug the tests cover but the UI could still expose confusingly —
watch for whether it is *understandable* from the screen, not just correct underneath.

**B4. Untick retracts the day.**
On a day with nothing else done: tick one exercise, check History shows today as
exercised, untick it, and confirm today is no longer marked. Then tick two, untick one,
and confirm the day *survives*.

**B5. Daily rollover.**
Tick Crunches. Set the machine's clock forward past local midnight, switch to another tab
and back (that fires the visibility check; there is also a 60s poll). The daily band must
clear while cycle exercises stay ticked. Put the clock back afterwards.

**B6. Settings.**
Add an exercise, edit one, change a cadence to `daily` and confirm it moves into the top
band, remove one and confirm it disappears from the list but that history is unaffected.
Change the admin password and confirm you can sign back in with the new one.

### Group C — resilience

**C1. Offline ticking.**
Load the page first, *then* set DevTools → Network → Offline. There is no service worker
yet, so a cold load offline is expected to fail — that is deferred work, not a bug.

Tick several exercises. The UI must update instantly and the header must show "Not saved
yet". Check the queue in the console:

```js
JSON.parse(localStorage.getItem('exse.outbox'))
```

Go back online. Within a couple of seconds one `POST /api/sync` should drain it, the
indicator should clear, and the outbox should be `[]`.

**C2. Sync race.**
Throttle the network hard (DevTools → Slow 3G). Tick one exercise, and while the sync
request is still in flight, tick another. When it settles, both ticks must be present and
the outbox empty. The failure mode being probed is the second tick being cleared along
with the first batch.

**C3. Session expiry.**
Delete the session cookie (DevTools → Application → Cookies). Tick something. Expect the
login screen — but local state and the outbox must survive; nothing should be wiped. Log
back in and confirm the pending tick flushes. A 401 must never be read as "you have no
data".

**C4. Restart persistence** *(Path A only)*. Ask for `docker compose restart` on the host
and confirm the browser is still signed in afterwards. This proves `COOKIE_SECRET` is
coming from the environment rather than being regenerated at boot.

### Group D — accessibility

**D1. Keyboard.** Tab through the Today list. Every tally mark must be reachable, must
toggle on Space/Enter, and must show a visible focus ring. They are
`<button role="checkbox" aria-checked>`, so check the announced state flips.

**D2. Screen reader spot-check.** VoiceOver or NVDA on the Today list. Each row should
announce the exercise name and whether it is checked. The year view is a single
`role="img"` labelled with the total days exercised, which is deliberate — 364 separate
announcements would be useless.

**D3. Reduced motion.** With `prefers-reduced-motion: reduce` (DevTools → Rendering),
ticking should be an instant state change with no stroke animation.

### Seeding history for A4 and B2

Several tests are dull on an empty database. Fastest way to get realistic data is
straight into Postgres — `active_days` has no dependencies beyond the user:

```sql
insert into active_days (user_id, day)
select u.id, d::date
from users u,
     generate_series(current_date - 200, current_date, interval '1 day') d
where u.username = 'admin'
  and random() < 0.6
on conflict do nothing;
```

That gives ~120 scattered days across the year view and a plausible streak. It only
touches the permanent day-level record, so it cannot corrupt cycle state.

---

## 3. Reporting back

Work on a branch and commit as you go:

```sh
git checkout -b browser-review
```

For each finding, note the group and test id (`A2`, `C1`, …), what you saw, what you
expected, viewport and theme, and attach the screenshot. Add them to `docs/TODO.md` under
a new `## From browser review` heading. Small, obvious fixes — a spacing value, a
contrast token, a wrapped label — are worth making directly, with the screenshot that
motivated them in the commit message. Anything that changes the design's intent rather
than its execution should be written up rather than fixed, since `docs/DESIGN.md` would
need to change with it.

If you touch any SQL query, run `cargo sqlx prepare` and commit `.sqlx/` — the Docker
build has no database and checks queries against that directory, so a stale one breaks the
build rather than the tests.

---

## 4. Do not report these

Known and deliberate, so finding them is not a finding:

- **No offline cold start, no install prompt, no app icon.** The PWA layer is deferred; it
  needs HTTPS first, since service workers require a secure context. See `docs/TODO.md`.
- **Plain HTTP on a LAN IP.** Exposure was deliberately postponed.
- **No drag handle for reordering.** The op, the server handler and the sort tie-break all
  work; Settings has no UI to drive them. Manual order is only the final tie-break, below
  the neglect ordering, so it rarely changes what you see.
- **Only one user.** Multi-user is an explicit non-goal.
- **No reps, sets, weights or timers.** Also explicit non-goals — the app answers "what
  haven't I done yet?" and nothing else.

---

## 5. Where things are

| Concern | File |
|---|---|
| Screen composition, tab switching, today's date | `web/src/App.jsx` |
| The tally glyph and its animation | `web/src/components/TallyMark.jsx` |
| Ordering rules — neglect, skip debt, tie-breaks | `web/src/lib/sort.js` |
| Local state, outbox, optimistic writes | `web/src/lib/store.js` |
| Flush, retry, 401 handling | `web/src/lib/sync.js` |
| Design tokens, light/dark, the double rule | `web/src/theme.css` |
| Ops, transactions, cycle bookkeeping | `src/routes/state.rs` |
| Schema, and why `completed_on` is a date | `migrations/001_init.sql` |

`docs/DECISIONS.md` explains the choices that are load-bearing and non-obvious — read it
before changing the retention model, the date handling, or where cycle progress is stored.
`docs/PLAN.md` is the full original plan. `docs/DESIGN.md` is the visual system, including
the specific defaults it was designed to avoid.
