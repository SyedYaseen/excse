# Decisions

Why the load-bearing choices are what they are. Read this before changing any of them.

## Cycle progress lives on the exercise row, not in the log table

`exercises.completed_on` holds current-cycle state; `exercise_logs` is pure history. (It is a
`date`, not a timestamp: "was this completed today?" decides whether a tap unticks or logs a
repeat, and that question only means anything in the user's timezone.)

The alternative — deriving cycle progress by querying logs for the current cycle — couples
progress to the retention window. A cycle that ran longer than `RETENTION_DAYS` would have its
progress pruned out from under it. Keeping progress on the row means the prune is a plain
date-window `DELETE` that can never corrupt cycle state.

## Two retention tiers

`exercise_logs` (which exercise, which day) is pruned after `RETENTION_DAYS` (default 21).
`active_days` (did I exercise at all that day) is **never** pruned. This is the app's one
permanence guarantee and the reason the year view exists.

## The client owns "today"

The container runs UTC. If the server called `current_date`, a 21:00 workout would be filed
under tomorrow. Every op carries an explicit local `day` computed by `web/src/lib/dates.js`,
and the server trusts it, rejecting only dates more than a day in the future.

The retention prune is the one place server-side `current_date` is used — the window is coarse
enough that a few hours' drift is irrelevant.

## A day is earned by four exercises, or claimed by hand

`active_days` used to gain a row on the first tick of anything. Ticking crunches at 23:50 filed
the day as a workout, which made the year view -- the thing the whole app exists to keep --
mean less the longer it ran.

A day now needs `DAY_MIN_EXERCISES` (default 4) **rotation** exercises logged against it. The
daily band is excluded on purpose: it is the staples you do anyway, not a session.

The rule is *recomputed* from the logs on every tick and untick rather than incremented. That
makes tick and untick symmetric for free, and it means the threshold can be changed later
without stranding rows written under the old one.

`active_days.manual` is the override. Marking a day from the calendar sets it, and the recount
never removes a row carrying it. Unmarking clears the override rather than deleting the day: if
the logs still earn it, it stays, because a day you actually trained through is not something a
tap should be able to deny. The client mirrors all of this in `store.js` and knows the
threshold because `/api/state` sends `dayThreshold`.

## Untick can retract an active day

`active_days` is permanent, but a mis-tap must not permanently record a workout that never
happened. Untick recounts the day and drops it if it no longer clears the threshold — unless it
was marked by hand. Once logs age out of the retention window the day is no longer retractable
by ticking: there is nothing left to untick. Unmarking it on the calendar still works.

## Tapping a done cycle exercise is date-dependent

Completed today → untick (mis-tap correction). Completed earlier this cycle → log today as
another occurrence, leaving cycle state alone.

Without the split, repeating an exercise later in the cycle records nothing, and if it were the
only thing done that day, the day would wrongly read as a rest day.

## The ordering rules run on demand, not on every tick

`organise()` is still the whole point of the app, and it is unchanged. What changed is when its
answer is applied.

Re-sorting after each tick moved the row under the thumb that had just tapped it, and worse, it
broke continuity: finishing one chest exercise could drop the whole chest group below three
others, so the next set was somewhere else on the screen. Mid-workout that is the opposite of
useful.

`freezeOrder()` takes a positional snapshot and `applyOrder()` re-imposes it on freshly
organised data, leaving every count live. The snapshot is retaken on a new day, on a new cycle,
and on `Re-sort`. It also records which categories were *already* complete, so a group you
finish now stays where it is instead of collapsing into the completed zone under your thumb.

`suggestNext()` reads the live rules for the `Next up:` control. Naming the least-worked group
costs nothing; moving it costs your place.

The alternative -- animating the re-sort so the move is legible -- was considered and rejected:
it makes the motion easier to follow but does not stop you having to follow it.

## Password reset is a command on the box, not a route

There is no "forgot password" link, and there should not be one: this is a single-user app on a
LAN with no email and no second factor, so a reset form is just a second, weaker way in.

What existed instead was worse. `bootstrap` only runs when the `users` table is empty, so the
de-facto recovery procedure was to delete the user -- and `sessions`, `exercises`, `cycles`,
`exercise_logs` and `active_days` all cascade off `users`. Recovering access destroyed the
permanent day record the app promises to keep forever.

`exse reset-password <username>` (`make reset-password`) changes one column and drops that
user's sessions. Nothing else is touched, and it requires access to the machine.

## Starter exercises are seeded from Rust, guarded by a table

Exercises carry a `user_id` foreign key, so a migration that runs before any user exists cannot
insert them. The catalogue lives in `src/seed.rs` and is applied at boot.

`seed_marks` is what stops it running twice. That guard is load-bearing: without it every
restart would resurrect exercises the user had deliberately archived. Bumping `CATALOGUE_SEED`
re-offers the list exactly once more.

Seeding merges by name rather than duplicating: an existing exercise with the same name has its
muscle group and cadence updated in place, which is how `Squats` moved out of the leg rotation
and into the daily band without leaving a second copy behind. Anything the user has that the
catalogue does not mention is left completely alone.

## Soft delete only

`exercises.archived_at` instead of `DELETE`, so historical logs stay resolvable to a name.

## Sessions table, not JWT

A signed cookie carrying a token plus a `sessions` row means logout and revocation actually
work. A JWT would need a denylist to match, which is strictly more machinery.

`COOKIE_SECRET` comes from the environment rather than being generated at boot — otherwise
every container restart signs the phone out.

## Zero JavaScript in the runtime image

Node and npm exist only in a throwaway Docker build stage running `vite build`. The runtime
image is a Rust binary plus static assets. A `vite`/`react` advisory affects a build we re-run,
not a running service.

## Standalone compose project

`exse` is not part of the mizadah stack: no Traefik router, no `themizadah.com` subdomain, no
labels. It attaches to the external `mz-net` network purely to resolve the `postgres` hostname.

**Caveat:** `mz-net` is owned by the mizadah compose project, so tearing that down takes this
app's database connectivity with it.

**Caveat:** the port binding names `192.168.1.18` explicitly so the app is LAN-only rather than
`0.0.0.0`. A DHCP address change breaks startup — use a static lease.

## PWA and HTTPS deferred

Service workers require a secure context, so offline mode cannot work over plain HTTP on a LAN
IP. Rather than ship a half-working PWA, v1 has no service worker at all. The client is still
local-first (optimistic writes + retry queue), which makes the later PWA step additive rather
than a rewrite.
