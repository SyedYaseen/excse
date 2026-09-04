# Decisions

Why the load-bearing choices are what they are. Read this before changing any of them.

## Cycle progress lives on the exercise row, not in the log table

`exercises.completed_at` holds current-cycle state; `exercise_logs` is pure history.

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

## Untick can retract an active day

`active_days` is permanent, but a mis-tap must not permanently record a workout that never
happened. Untick deletes the day row only when no logs remain for that day. Once logs age out
of the retention window the day is no longer retractable — by then it is a permanent fact.

## Tapping a done cycle exercise is date-dependent

Completed today → untick (mis-tap correction). Completed earlier this cycle → log today as
another occurrence, leaving cycle state alone.

Without the split, repeating an exercise later in the cycle records nothing, and if it were the
only thing done that day, the day would wrongly read as a rest day.

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
