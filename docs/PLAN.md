# exse — home exercise tracker

## Context

You work out at home with no equipment, so the pool of exercises is small and you keep
forgetting which ones you've already hit this round. You want a phone-first app that lets you
tick exercises off, pushes the ones you *haven't* done to the top, tracks which muscle groups
you're neglecting, and keeps a permanent record of which days you exercised at all.

Two retention tiers matter: *"I did bicep curls on Fri 4 Sep"* is disposable after a few weeks,
but *"I exercised on Fri 4 Sep"* must survive forever.

`/home/poochi/projects/exse/` is currently empty — this is greenfield. It will run on the
existing home Docker host alongside the current `postgres` container.

**On the design skill:** there was no `/design` skill in the marketplace. The closest match is
Anthropic's official **`frontend-design`** plugin, which has now been installed (user scope,
enabled). The Visual design section below is its output.

### Decisions already made with you
- Daily staples (crunches) live in a **pinned band** at the top, separated from the once-per-cycle
  rotation by a double rule.
- **Phone only** → local-first with a simple append-only outbox. No conflict-resolution code.
- Include: streaks + year view, smart-neglect tie-break, cycle stats, reset guardrails.
- **You can end a cycle early**, leaving exercises undone — those skips are recorded and carried
  to the top of the next cycle.
- **Standalone — not part of mizadah.** Own compose project, no Traefik router, no
  `themizadah.com` subdomain. Plain HTTP on the LAN.
- **No service worker / PWA layer in v1.** Deferred to `docs/TODO.md`.
- **Rust + Axum backend**, matching your existing `mzbe`. Node is a **build-time tool only** —
  see below.

---

## Dependency posture

This is the load-bearing constraint, so it drives the stack rather than being bolted on.

**The production container ships zero JavaScript dependencies.** Node/npm exist only inside a
throwaway Docker build stage that runs `vite build`; the runtime image is a Rust binary plus a
folder of static assets. Nothing from `node_modules` is ever executed on the server, so the npm
advisory stream stops being your problem — a `vite`/`react` CVE at worst affects a build you
re-run, not a running service.

**Rust deps** — every crate below except `axum-extra` is already in `mzbe`'s `Cargo.toml`, so
this adds essentially no new supply chain to your machine:

```toml
axum        = "0.8"                                    # no multipart needed here
axum-extra  = { version = "0.10", features = ["cookie-signed"] }   # session cookie
tokio       = { version = "1", features = ["rt-multi-thread","macros","net","signal","time"] }
tower-http  = { version = "0.6", features = ["fs","trace","compression-gzip"] }
sqlx        = { version = "0.8", features = ["runtime-tokio-rustls","postgres","uuid","chrono","migrate","macros"] }
uuid        = { version = "1", features = ["v4","serde"] }
serde       = { version = "1", features = ["derive"] }
serde_json  = "1"
argon2      = "0.5"
rand        = "0.8"
chrono      = { version = "0.4", features = ["serde"] }
dotenvy     = "0.15"
anyhow      = "1"
thiserror   = "2"
tracing     = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
```

Notably absent: no `jsonwebtoken` (a signed cookie + a `sessions` table is simpler and
revocable), no web framework extras, no ORM on top of sqlx. `rustls` throughout means no
OpenSSL in the runtime image.

**Node deps (build-time, in `web/` only)** — the entire `package.json` is `react`,
`react-dom`, `vite`, `@vitejs/plugin-react`. No router, no UI library, no state library, no
date library, no chart library. Everything else is hand-written CSS and ~5 small JS modules.

**"Don't reinvent" line:** password hashing is `argon2`, cookie signing is `axum-extra`'s
`SignedCookieJar`, migrations are `sqlx::migrate!`, static file serving is `tower-http`'s
`ServeDir`. The only things written by hand are this app's actual logic.

---

## Environment facts (verified)

| Thing | Value |
|---|---|
| Postgres | container `postgres`, `postgres:15-alpine`, network `mz-net` (external), superuser `mzusr`, bound `127.0.0.1:5432` |
| Existing DBs | `mizadah`, `odysmarket` → add `exse` |
| LAN IP | `192.168.1.18` |
| Free port | `3005` (22/53/80/139/443/445/3000/3001/3002/4321/4325/5432/8000/8080/8096/9090/55432 taken) |
| Node (build only) | v24.12.0, npm 11.6.2 — **no pnpm** |
| Reference project | `/home/poochi/mz/cartio` — axum 0.8, sqlx 0.8 + `SQLX_OFFLINE=true` + `.sqlx`, cargo-chef Dockerfile, `NNN_name.sql` migrations |

The only coupling to the existing stack is the Postgres container. `exse` gets its **own
database and its own role**, and attaches to `mz-net` purely to resolve the `postgres`
hostname — Traefik's `exposedByDefault: false` means an unlabelled container there is invisible
to it.

---

## Repo layout

```
exse/
  docs/{PLAN.md,TODO.md,DECISIONS.md,DESIGN.md}
  Cargo.toml  Cargo.lock  .sqlx/          # committed offline query data
  migrations/001_init.sql
  src/
    main.rs          # config, pool, migrate, router, graceful shutdown
    error.rs         # AppError -> IntoResponse
    auth.rs          # argon2, session issue/verify, AuthUser extractor
    models.rs        # sqlx FromRow structs + the tagged Op enum
    retention.rs     # background prune task
    routes/{mod.rs,auth.rs,state.rs}
  web/
    package.json  vite.config.js  index.html
    src/
      main.jsx  App.jsx  theme.css
      lib/{store.js,api.js,sync.js,sort.js,dates.js}
      components/{ProgressRule,TallyMark,DailyBand,Rotation,CategoryGroup,ExerciseRow,
                  CycleButton,EndCycleSheet,Calendar,YearTally,Login,Settings,ThemeToggle}.jsx
  Dockerfile  docker-compose.yaml  .env.example  .gitignore  README.md
```

---

## Data model (`migrations/001_init.sql`, database `exse`)

The one idea that makes everything else simple: **current-cycle progress lives on the exercise
row (`completed_at`), not in the log table.** That makes the log table pure disposable history,
prunable on a fixed date window with zero risk to cycle state — even if a cycle runs longer than
the retention window.

```sql
users(id uuid pk, username text unique, password_hash text, created_at timestamptz)
sessions(token text pk, user_id uuid fk, expires_at timestamptz)

exercises(
  id uuid pk,                -- client-generated, so rows created offline sync cleanly
  user_id uuid fk, name text, category text,
  cadence text check (cadence in ('cycle','daily')) default 'cycle',
  sort_order int, skip_streak int default 0,
  completed_at timestamptz,  -- current-cycle tick; NULL = not done. Unused for 'daily'.
  archived_at timestamptz,   -- soft delete only, so old logs stay resolvable
  created_at timestamptz)

cycles(id uuid pk, user_id uuid fk, seq int, started_on date, ended_on date,
       ended_early bool default false, done_count int, total_count int)
cycle_skips(cycle_id uuid fk, exercise_id uuid fk, primary key(cycle_id, exercise_id))

-- disposable detail, PRUNED after RETENTION_DAYS (default 21)
exercise_logs(user_id uuid fk, exercise_id uuid fk, day date,
              primary key(user_id, exercise_id, day))

-- the permanent fact, NEVER pruned
active_days(user_id uuid fk, day date, primary key(user_id, day))
```

- The `exercise_logs` primary key makes ticks **idempotent facts** — replaying the outbox after
  a flaky connection is safe by construction.
- Every tick upserts `active_days` in the same transaction.
- `retention.rs` spawns a task that runs on boot then every 24h:
  `DELETE FROM exercise_logs WHERE day < current_date - $1::int`.
- `active_days` is ~365 short rows/year — the whole history ships to the client in a few KB.

### Bootstrap (not a SQL seed file)

Exercises carry a `user_id` FK, so they cannot be seeded by a migration that runs before any
user exists. Bootstrap is therefore a single Rust transaction in `main.rs`, run after
`sqlx::migrate!` and skipped entirely if `users` is non-empty:

1. create `admin` with `ADMIN_INITIAL_PASSWORD` from the environment (argon2id), log a loud
   warning to change it;
2. insert ~15 no-equipment exercises across Core / Back / Chest / Shoulders / Legs / Glutes,
   with crunches + plank as `cadence='daily'`;
3. open cycle `seq = 1`.

`GET /api/state` also lazily opens a cycle if none is open, so the app can never reach a state
with no current cycle. `README.md` documents the raw `INSERT` for creating the admin by hand.
Password change lives in Settings.

---

## API

```
POST /api/login     {username,password}  → sets signed httpOnly session cookie (90d rolling)
POST /api/logout
GET  /api/me
POST /api/password  {current,next}
GET  /api/state     → {exercises[], cycle, logs[] (last RETENTION_DAYS), activeDays[], stats}
POST /api/sync      {ops:[...]}          → applies ops idempotently, returns fresh full state
```

Ops are a serde-tagged enum in `models.rs` — the type safety here is the main reason the Rust
backend is a better fit than the Node one:

```rust
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Op {
    Tick { exercise_id: Uuid, day: NaiveDate },
    Untick { exercise_id: Uuid, day: NaiveDate },
    EndCycle { early: bool, day: NaiveDate },
    UpsertExercise { id: Uuid, name: String, category: String, cadence: Cadence, sort_order: i32 },
    ArchiveExercise { id: Uuid },
    Reorder { ids: Vec<Uuid> },
}
```

The whole op batch applies in **one transaction**, then the handler returns the complete fresh
state. Because it's single-device, the client replaces its local copy wholesale — no merge code
to maintain on either side.

**Auth** — `AuthUser` is a `FromRequestParts` extractor (~40 lines): read the signed cookie via
`SignedCookieJar` (key from `COOKIE_SECRET`), look the token up in `sessions`, check expiry.
Any `/api` handler that takes `AuthUser` is protected; forgetting it is a compile error rather
than a silent hole. Session rows mean logout and revocation actually work, unlike a JWT.

**Static serving** — `tower-http`'s `ServeDir::new("dist")` with a
`ServeFile::new("dist/index.html")` fallback, mounted under `/` after the `/api` routes.

---

## Client behaviour

**Optimistic + retry queue.** All reads come from `localStorage` (`exse.state`); every mutation
applies locally at once and appends an op to `exse.outbox`. `sync.js` flushes the outbox on
load, on `visibilitychange`, on `online`, and 2s (debounced) after any change. On failure the
outbox is kept and the header shows an unsynced dot. The dataset is a few dozen exercises and
~1k day records, so `localStorage` is genuinely sufficient — no IndexedDB wrapper.

This is ~80 lines and earns its keep even without a service worker: ticking never blocks on the
network, and dropped WiFi mid-workout can't lose a tick. It's also exactly the substrate the
deferred PWA step needs, so that step stays additive.

**Dates.** `dates.js` produces local `YYYY-MM-DD` only — never UTC. A late-evening workout must
land on the day you did it. A day-rollover check clears the daily strip at local midnight.

**Daily vs cycle semantics.**
- `cadence='daily'` → "done" is `logs[today].has(id)`. Resets at local midnight for free, never
  touches `completed_at`, never counts toward cycle completion.
- `cadence='cycle'` → "done" is `completed_at != null`, cleared only by ending a cycle.

Tapping behaviour depends on *when* the exercise was completed — see Correctness details.

### Sorting (`sort.js`) — the core requirement

Lives client-side because the local-first client must be able to re-sort without the server.

Categories, ordered by:
1. `done/total` ascending — never-started categories (ratio 0) float to the top
2. `skipDebt` descending — sum of `skip_streak` across the category's exercises
3. days since the category was last trained, descending *(smart neglect tie-break)*
4. name ascending

Within a category:
1. undone first
2. among the undone, highest `skip_streak` first — carried-over skips surface with a badge
3. then your manual `sort_order`
4. done ones last and dimmed

Fully-complete categories **collapse to a single struck-through line** and sink below the
hairline, keeping the top of the screen purely actionable.

### Ending a cycle (incl. early)
One button, two characters:
- **Cycle complete** → full-width primary `Start cycle 4`.
- **Cycle incomplete** → muted `End cycle early`. Tapping opens a sheet naming exactly what gets
  skipped — *"Superman, Bird dog and 3 more will carry to the top of your next cycle."* — with
  an explicit confirm.

`EndCycle` in one transaction: close the current `cycles` row (`ended_early`, `done_count`,
`total_count`), insert a `cycle_skips` row per undone cycle exercise, `skip_streak += 1` for
each skipped and `= 0` for each completed, `completed_at = NULL` for all, open the next cycle.

### History view
Month calendar with a mark per `active_days` entry (permanent), the year tally below it (see
Visual design), current/longest streak, and past-cycle summaries showing length and whether a
cycle ended early. Tapping a day inside the retention window reveals which exercises you did;
outside it, only "you exercised" — the two-tier promise, made visible.

---

## Correctness details

These are the non-obvious rules. Each one is a bug if implemented naively, so they're spelled
out here and each gets a test.

**The client owns "today", the server never computes it.** The runtime container is UTC; a
21:00 workout in your timezone would land on the wrong day if the server used `current_date`.
Every op carries an explicit local `day` from `dates.js`, and the server trusts it — rejecting
only dates more than one day in the future, as corruption defence. The one exception is the
retention prune, where server-side `current_date` is fine because the window is coarse.

**Untick must be able to retract an active day.** `active_days` is permanent, but a mis-tap
must not permanently record a workout that never happened. On untick, delete the log row, then
delete the `active_days` row *only if no logs remain for that day*:
```sql
DELETE FROM active_days a WHERE a.user_id=$1 AND a.day=$2
  AND NOT EXISTS (SELECT 1 FROM exercise_logs l WHERE l.user_id=$1 AND l.day=$2);
```
Once logs age out past the retention window the day is no longer retractable, which is correct —
by then it's a permanent fact.

**Tapping an already-done cycle exercise is date-dependent.** Two different intents share one
gesture, so they're separated by *when* the exercise was completed:
- completed **today** → untick (correcting a mis-tap);
- completed **earlier this cycle** → log today as another occurrence. Adds an `exercise_logs`
  row and an `active_days` row, leaves `completed_at` and cycle state untouched.

Without this, doing push-ups again on Thursday after completing them Monday records nothing —
and if it were your only exercise that day, Thursday would wrongly show as a rest day, breaking
the one guarantee the app makes about permanence.

**Cycle bookkeeping ignores daily and archived rows.** Every query touching cycle
completion, `EndCycle` skips, `skip_streak`, and `done_count`/`total_count` filters
`cadence='cycle' AND archived_at IS NULL`. Daily exercises are never "skipped"; archived ones
never block cycle completion.

**Sync must not drop ops raced against a flush.** Snapshot the outbox length before sending; on
success remove exactly those N ops, apply the server state, then re-apply the remaining ops on
top. Clearing the whole outbox would silently lose any tick made during the round trip.

**A 401 must not wipe local state.** If the session expires, keep local state and the outbox
intact, show the login screen, and flush the outbox after re-login. Never treat an auth failure
as "server says you have no data".

**`COOKIE_SECRET` comes from the environment**, not generated at boot — otherwise every
container restart signs out the phone. `.env.example` carries a generation command.

**Ops apply in array order** within the single transaction, and the outbox preserves insertion
order, so an `UpsertExercise` always precedes a `Tick` referencing it.

**Day rollover while the app is open**: a visibility/interval check recomputes today and clears
the daily band, so a daily ticked at 23:55 reads as untouched at 00:05 rather than still done.

**`Reorder{ids}`** assigns `sort_order = index` across the whole submitted list. It's only the
final tie-break inside a category — the neglect ordering always wins over it.

**Infra caveats**: `mz-net` is owned by the mizadah compose project, so tearing that down takes
`exse`'s DB connectivity with it. And binding `192.168.1.18:3005` means a DHCP address change
breaks startup — use a static lease. Both are accepted trade-offs of reusing the existing
Postgres, and both go in `docs/DECISIONS.md`.

---

## Visual design

Produced with the `frontend-design` skill (`frontend-design@claude-plugins-official`, installed
user-scope). Two passes: plan, then critique against the brief.

### Grounding
One person, at home, on a phone, mid-workout, answering *"what haven't I done yet?"* in under
two seconds with one thumb. Not a gym-bro app (no chrome, no neon, no BEAST MODE), not a
clinical health dashboard. The nearest real-world object is a **tally sheet** — quiet,
repetitive, unglamorous, about accumulation over time. Every choice below comes from that.

### The one bold move: the tick *is* a tally mark
Not a rounded square with a checkmark. Each exercise carries a single vertical stroke `│`;
tapping draws a diagonal slash through it — the tally gesture — and strikes through the name.
You are literally making a mark on a sheet. It costs one glyph, reads instantly at arm's length
on a sweaty phone, and scales from the daily row to the year view.

Everything else stays quiet. Per the skill's restraint rule, boldness is spent here and nowhere
else.

The mark is a real control, not a styled `<div>`: a `<button role="checkbox" aria-checked>` with
the stroke drawn in SVG, a ≥44px hit area, and a visible focus ring. A custom tick glyph is the
easiest place in this design to accidentally ship something unusable by keyboard or screen
reader.

### Tokens

**Color.** Deliberately avoiding both the cream/serif/terracotta cluster and the near-black +
acid-accent cluster that fitness apps default to. Ground is a pale cool chalk-grey; the accent
appears in exactly two places (the cycle button, today's marker on the calendar). Completion is
signalled by strike-through and dimming, not by colour — so the palette stays almost monochrome.

```css
:root {                        /* light */
  --paper:#E8EAE6; --raise:#F5F6F3; --rule:#C9CDC7;
  --ink:#1A1F1C;   --ink-2:#5C6360; --done:#8B928D;
  --mark:#2E4756;                       /* deep slate — the only accent */
}
/* dark */  --paper:#14171A; --raise:#1C2023; --rule:#2C3235;
            --ink:#E6E9E5;   --ink-2:#8D948F; --done:#5A615C; --mark:#7FB2CC;
```

**Type.** One family: **Archivo variable** (SIL OFL), self-hosted woff2, latin subset only —
keep both the `wght` and `wdth` axes (~80KB), since the design uses the width axis. No CDN, no
external request, consistent with the dependency posture. Two roles from the *width* axis rather
than a second typeface: Archivo Expanded for the few display moments, regular for the list. Its
utilitarian grotesque character suits a log sheet; Inter and Space Grotesk are the defaults here
and are avoided. Counts use `font-variant-numeric: tabular-nums` so the list never jitters —
function, not the monospace-data-label tell.

**Layout.** Left-aligned throughout, counts right-aligned to one column — ledger alignment.
**No hero banner and no cards anywhere.** The list *is* the hero: content starts at the top of
the viewport. Cycle progress is a 2px rule spanning the full width that fills left-to-right —
it is simultaneously the app's only chrome and its only stat, one element doing two jobs.
Structure comes from rules and vertical rhythm, never from bordered boxes or shadows.

A **double rule** separates the daily band from the rotation. That is structural information,
not decoration: it encodes "everything above resets nightly, everything below persists" without
needing a label to say so.

### Layout
```
 ▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░   ← progress rule = the entire header
 Cycle 3                  11 left

 Crunches      ╱ ╱ ╱ · ╱ ╱ ╱   ╱│    ← last 7 days, then today's mark
 Plank         · ╱ ╱ · ╱ ╱ ╱   ╱│
 Squats        ╱ · ╱ ╱ · · ╱    │    ← today not yet marked
 ═════════════════════════════════   ← above resets nightly, below persists

 Back                          0/4
   │  Superman        skipped twice
   │  Bird dog
   │  Reverse snow angel

 Core                          1/3
   │  Leg raises
  ╱│  Hollow hold
 ─────────────────────────────────
  Chest                        4/4
  Shoulders                    3/3
```
Completed categories collapse to one struck-through line and sink below the hairline, so the top
of the screen is only ever what's still actionable.

### The year view is the payoff
The permanent `active_days` record renders as **52 columns of 7 tally strokes** — a wall of
marks accumulated over a year. Not GitHub squares, which is the default and would undercut the
metaphor. This is the emotional payload of the whole brief ("the fact I exercised on 4 Sep
matters indefinitely"), so it gets the strongest single image in the app.

### Motion
One orchestrated moment, and it answers a user action: on tick, the slash strokes in over ~140ms,
the name strikes through, and if that completed a category, the category collapses and settles
into the completed zone. No page-load fades, no per-row hover transitions. `prefers-reduced-motion`
drops all of it to instant state changes.

### Copy
Plain, active, user-perspective, each element doing one job:
- Complete → `Start cycle 4`. Incomplete → `End cycle early`.
- Confirm sheet: *"Superman, Bird dog and 3 more will carry to the top of your next cycle."*
- Unsynced: *"Not saved yet"* — what the user cares about, not "Offline".
- Login failure: *"Wrong username or password."* No apology, not vague.
- Empty state: *"Add the exercises you can do at home. You'll tick them off as you go."*

### Quality floor
`theme.css` defines the light palette on bare `:root`, redefines tokens under
`@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])`, and again
under `:root[data-theme="dark"]` so the toggle wins both directions. Settings cycles
system → light → dark and updates `<meta name="theme-color">`.

≥44px touch targets, visible keyboard focus, `env(safe-area-inset-*)` padding,
`navigator.vibrate(10)` on tick, tap-again to untick. The `viewport` / `theme-color` /
`apple-mobile-web-app-capable` meta tags are free and make Add-to-Home-Screen give a chrome-less
shell even with no service worker.

---

## Deployment

`Dockerfile` — four stages, following `mzbe`'s cargo-chef pattern:
1. `node:24-alpine` → `npm ci && npm run build` in `web/` → `dist/`
2. `rust:1.94-slim` planner → `cargo chef prepare`
3. `rust:1.94-slim` builder → `cargo chef cook --release`, then `SQLX_OFFLINE=true cargo build --release`
4. `debian:bookworm-slim` runtime → non-root user, the binary, and `dist/`. Nothing else —
   no Node, no `node_modules`, no OpenSSL (rustls).

`docker-compose.yaml` — its **own compose project** (`name: exse`), no Traefik labels, no
domain. Attaches to the external `mz-net` network solely to resolve `postgres`
(`DATABASE_URL=postgres://exse:…@postgres:5432/exse`) and publishes `192.168.1.18:3005:3005` —
bound to the LAN interface, not `0.0.0.0`, so it is unreachable from the tunnel or the internet.
Access is `http://192.168.1.18:3005`.

DB bootstrap is a documented one-liner in `README.md` (needs superuser, so it's a manual step):
```
docker exec -it postgres psql -U mzusr -d postgres \
  -c "CREATE ROLE exse LOGIN PASSWORD '…';" -c "CREATE DATABASE exse OWNER exse;"
```

`README.md` also documents the one bit of build friction inherited from sqlx macros: after
changing any query, run `cargo sqlx prepare` against a live DB and commit `.sqlx/`, or the
Docker build fails. You already do this for `cartio`.

---

## Build order (each step = one git commit)

`git init` first — the directory is not yet a repo. Then:

1. Scaffold: `Cargo.toml`, `web/` Vite+React skeleton, `.gitignore`, `docs/{PLAN,TODO,DECISIONS,DESIGN}.md`
2. `001_init.sql`; create the `exse` role/database; pool + `sqlx::migrate!` on boot
3. `auth.rs`: argon2 helpers, sessions, `AuthUser` extractor, login/logout/me, bootstrap txn
4. `models.rs` + `routes/state.rs`: `GET /api/state`, `POST /api/sync` with all ops, one transaction
5. `retention.rs` prune task + the `active_days` upsert path
6. Client core: `store.js`, `dates.js`, `api.js`, `sync.js`, outbox + offline indicator
7. `sort.js` + unit tests for the ordering rules
8. Design foundation: vendor the Archivo woff2 subset, `theme.css` tokens, the `TallyMark`
   component and its tick animation
9. UI: progress rule + header, daily band, Rotation/CategoryGroup/ExerciseRow, collapse behaviour
10. CycleButton + EndCycleSheet incl. the early-end skip flow
11. History: month calendar, the 52×7 tally year view, streaks, cycle summaries
12. Light/dark toggle, reduced motion, mobile polish
13. Settings: manage exercises, cadence toggle, reorder, change password
14. Dockerfile + docker-compose + README

`docs/TODO.md` is the living checklist, updated as each step lands so the work can be picked up
cold. Its **Deferred** section carries what we consciously cut:

- **PWA layer** — `vite-plugin-pwa`, manifest, maskable icons, offline app shell.
- **HTTPS** — a prerequisite for the above, since service workers need a secure context.
  Options when you get to it: a DNS-only A record on a domain you own pointing at
  `192.168.1.18` so a real cert can cover a private IP, or a local CA installed on the phone.

`docs/DECISIONS.md` records the *why* behind the load-bearing choices: cycle progress on the
exercise row rather than in the log table; local-date handling; soft-delete; sessions table over
JWT; zero JS in the runtime image; standalone compose project; deferred PWA/HTTPS.

`docs/DESIGN.md` carries the Visual design section above — tokens, the tally metaphor, and the
tells that were deliberately avoided — so future changes extend the design rather than drift
back to defaults.

---

## Verification

- **Sort rules** — `node --test` over `sort.js` fixtures: never-started category on top,
  skip-debt tie-break, neglect tie-break, completed categories sinking and collapsing.
- **Backend** — `#[sqlx::test]` integration tests (ephemeral per-test databases, no fixture
  container needed):
  - *Retention*: insert logs backdated 30 days, run the prune, assert `exercise_logs` is trimmed
    while `active_days` is untouched and current-cycle `completed_at` flags survive.
  - *Early cycle end*: tick some, end early, assert `cycle_skips` rows exist, `skip_streak`
    incremented only for the skipped, all `completed_at` cleared, next cycle opened.
  - *Idempotency*: replay the same tick op batch twice, assert no duplicate rows and identical
    resulting state.
  - *Untick retracts an active day*: tick one exercise, untick it, assert the `active_days` row
    is gone. Then tick two, untick one, assert the row **survives**.
  - *Re-tick on a later day*: tick on day 1, tick the same exercise on day 3, assert a second
    `exercise_logs` row and a day-3 `active_days` row exist while `completed_at` is unchanged.
  - *Daily and archived exclusion*: end a cycle early with an undone daily and an undone
    archived exercise present, assert neither gets a `cycle_skips` row or a `skip_streak` bump.
  - *Date trust*: an op dated two days in the future is rejected; one dated yesterday is accepted.
  - *Auth*: unauthenticated `/api/state` is 401; a logged-out session token stops working.
  - *Bootstrap*: on an empty database, boot once and assert admin, starter exercises, and cycle
    1 all exist; boot again and assert nothing is duplicated.
- **Daily rollover** — tick a daily, advance the client clock past local midnight, assert the
  band clears while cycle exercises are unaffected.
- **Network drop** — DevTools offline, tick several exercises, confirm the UI still updates and
  the outbox grows; back online, confirm one `/api/sync` drains it and server state matches.
  (The page must already be loaded — with no service worker, a cold load needs the server.)
- **Sync race** — throttle the network, tick during an in-flight flush, and assert the late tick
  survives rather than being cleared with the batch.
- **Session expiry** — delete the session row server-side, act in the app, and assert local
  state and outbox survive the 401 and flush after re-login.
- **Restart persistence** — `docker compose restart`, confirm the phone is still logged in
  (proves `COOKIE_SECRET` is not being regenerated).
- **Accessibility** — tab through the list: every tally mark is reachable, announces its checked
  state, and shows a visible focus ring.
- **End to end on the phone** — `docker compose up -d --build`, open `http://192.168.1.18:3005`
  over LAN, log in as admin, run a full cycle, end one early, check the calendar and year tally.

---

## Explicit non-goals

Reps/sets/weight logging, rest timers, multi-user, charts beyond the year tally, and any
third-party UI or state library. Keeping these out is what makes the app maintainable solo.
