# exse

A home exercise tracker for one person and one phone.

Tick exercises off as you do them — tapping anywhere on the row, name included.
The ones you haven't done stay at the top, and the muscle group you've been
avoiding sorts above the ones you haven't. When the list is finished — or when
you decide you've had enough of it — one button starts the next cycle.

The order holds still while you work. It is recomputed when you open the app,
on a new day, on a new cycle, and when you tap `Re-sort` — never under your
thumb mid-set. `Next up:` in the header names the least-worked unfinished group
and scrolls you to it without moving anything.

Two things are tracked, and they age differently:

- **Which exercises you did on a given day** is kept for `RETENTION_DAYS`
  (default 21), then pruned.
- **That you exercised at all on a given day** is kept forever. This is the
  record the year view is built from, and nothing deletes it.

A day counts once you have done `DAY_MIN_EXERCISES` (default 4) exercises from
the rotation. The daily band doesn't count towards it — crunches and a plank are
not a session. Tap any day on the calendar to mark or unmark it by hand.

## Stack

Rust + Axum + sqlx on Postgres, React built by Vite. Node is a build-time tool
only: the runtime image is a Rust binary plus static files, with no
`node_modules` in it. `web/package.json` has four direct dependencies.

## First run

The `exse` role and database are created once by hand, since it needs a
Postgres superuser:

```sh
docker exec -it postgres psql -U mzusr -d postgres \
  -c "CREATE ROLE exse LOGIN PASSWORD 'pick-something';" \
  -c "CREATE DATABASE exse OWNER exse;"
```

Then copy `.env.example` to `.env` and fill it in:

```sh
cp .env.example .env
openssl rand -hex 64     # COOKIE_SECRET
```

`COOKIE_SECRET` must stay stable across restarts or your phone gets signed out
every deploy. `ADMIN_INITIAL_PASSWORD` is used only on the very first boot,
when the `users` table is empty, to create `admin` along with the starter
catalogue in `src/seed.rs` and cycle 1. Change it in Settings afterwards — the
server logs a warning until you do.

```sh
docker compose up -d --build
```

It listens on `http://192.168.1.18:3005`, bound to the LAN address rather than
`0.0.0.0`, so it is not reachable from the Cloudflare tunnel or the internet.

### Creating the admin by hand instead

If you'd rather not put a password in the environment, leave
`ADMIN_INITIAL_PASSWORD` unset and insert the row yourself. The hash must be
argon2id — generate one with any argon2 CLI, then:

```sql
insert into users (username, password_hash) values ('admin', '$argon2id$...');
insert into cycles (user_id, seq, started_on)
  select id, 1, current_date from users where username = 'admin';
```

You'll then need to add exercises through Settings.

## Forgetting the password

Not a link on the login screen — there is no email here and no second factor, so
a reset form would just be a weaker second way in. It is a command on the box
that owns the database:

```sh
make reset-password            # USER=admin by default, on the server
make reset-password-local      # against the database in ./.env
```

It prompts for the new password on stdin (so it never reaches your shell
history), changes one column, and drops that user's sessions. Nothing else is
touched.

**Do not** recover by emptying the `users` table so `ADMIN_INITIAL_PASSWORD`
fires again. Every data table cascades off `users`, including the permanent
`active_days` record — that would trade your year view for a password.

## Changing the exercise list

`src/seed.rs` holds the catalogue. It is applied at boot to any user who has not
seen it, guarded by the `seed_marks` table so a restart can't resurrect
something you archived. To re-offer an edited catalogue, bump `CATALOGUE_SEED`.

Seeding merges by name: an exercise you already have keeps its row and history
and just takes the catalogue's muscle group and cadence. Anything the catalogue
doesn't mention is left alone. Day to day, though, Settings is the place to add,
edit and archive — the catalogue is only the starting point.

## Development

```sh
make dev                     # build the UI, run the server on :3005
make dev-ui                  # plus Vite on :5173 with hot reload
make deploy                  # push this branch, pull and rebuild on the server
make help                    # everything else
```

The underlying commands, if you would rather not use make:

```sh
cargo run                    # API + serves ./dist on :3005
npm --prefix web run dev     # Vite dev server, proxies /api to :3005
```

Tests (`make check` for the first two, `make test` for all three):

```sh
cargo test                   # 19 integration tests, ephemeral databases
npm --prefix web test        # 31 unit tests
npm --prefix e2e test        # 56 browser tests, phone viewport, both themes
```

`e2e/` drives a running server and a real database rather than starting either
— bring the app up first. It is a separate npm package on purpose, so `web/`
keeps its four dependencies and nothing test-related can reach the runtime
image. See `e2e/README.md`.

`cargo test` uses `#[sqlx::test]`, which creates a throwaway database per test.
That needs `CREATEDB`:

```sh
docker exec postgres psql -U mzusr -d postgres -c "ALTER ROLE exse CREATEDB;"
```

If `cargo build` fails with a wall of `relation "exercises" does not exist`, the
sqlx macros are checking a database that has not been migrated yet. Build
against the committed query cache instead:

```sh
SQLX_OFFLINE=true cargo build
```

### Never edit an applied migration

Not even a comment. sqlx checksums each one and refuses to start with
"migration N was previously applied but has been modified". Nothing local
catches it — `cargo test` builds a fresh database per test — so it surfaces as
a crash-looping container against the one database that already ran the old
bytes. Corrections go in a new migration.

### After changing a SQL query

Queries are checked at compile time against `.sqlx/`, so the Docker build needs
no database. Regenerate and commit it whenever a query changes, or the build
fails:

```sh
cargo sqlx prepare
```

## How it works

Worth knowing before changing anything:

- **Cycle progress lives on `exercises.completed_on`**, not derived from the
  log table. That's what makes pruning safe — a cycle that runs longer than the
  retention window keeps its state.
- **The client owns "today".** The container runs UTC, so a 21:00 workout would
  be filed under tomorrow if the server decided. Every operation carries an
  explicit local date.
- **Ticking is idempotent**, keyed on (exercise, day). The client keeps an
  outbox and replays it, so a dropped connection mid-workout can't lose a tick.
- **Tapping a done exercise depends on when it was done.** Completed today
  means untick. Completed earlier in the cycle means log today as a repeat, so
  the day still counts.

- **The order is frozen between sorts.** `organise()` is unchanged and still
  runs live; `freezeOrder`/`applyOrder` in `web/src/lib/sort.js` decide when its
  answer is applied. Counts stay live inside a frozen order.
- **A day is recomputed, not incremented.** `recount_day` in
  `src/routes/state.rs` re-derives it from the logs on every tick and untick, so
  the threshold can change without stranding old rows. `active_days.manual` is
  the override and the recount never removes it.

`docs/DECISIONS.md` has the reasoning. `docs/DESIGN.md` covers the visual
system. `docs/TODO.md` tracks what's left, including the deferred PWA/offline
work and the HTTPS it depends on.

`docs/HANDOFF.md` is the original browser-testing brief.
