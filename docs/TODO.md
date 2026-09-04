# TODO

Living checklist. Each step is one commit. Update as things land so this can be picked up cold.

## Build order

- [x] 1. Scaffold — `Cargo.toml`, `web/` Vite+React skeleton, `.gitignore`, docs
- [x] 2. `001_init.sql`; create `exse` role/database; pool + `sqlx::migrate!` on boot
- [x] 3. `auth.rs` — argon2, sessions, `AuthUser` extractor, login/logout/me, bootstrap txn
- [x] 4. `models.rs` + `routes/state.rs` — `GET /api/state`, `POST /api/sync`, one transaction
- [x] 5. `retention.rs` prune task + `active_days` upsert path
- [x] 6. Client core — `store.js`, `dates.js`, `api.js`, `sync.js`, outbox + unsynced indicator
- [x] 7. `sort.js` + unit tests for the ordering rules
- [x] 8. Design foundation — Archivo woff2, `theme.css` tokens, `TallyMark` + tick animation
- [x] 9. UI — progress rule, daily band, Rotation/CategoryGroup/ExerciseRow, collapse
- [x] 10. CycleButton + EndCycleSheet incl. early-end skip flow
- [x] 11. History — month calendar, 52×7 year tally, streaks, cycle summaries
- [x] 12. Light/dark toggle, reduced motion, mobile polish
- [x] 13. Settings — manage exercises, cadence toggle, reorder, change password
- [x] 14. Dockerfile + docker-compose + README
- [x] 15. Browser review + Playwright suite (`e2e/`) — see "From browser review"

## Deferred (consciously cut from v1)

- [ ] **PWA layer** — `vite-plugin-pwa`, manifest, maskable icons, offline app shell.
- [ ] **HTTPS** — prerequisite for the above; service workers need a secure context.
      Options: a DNS-only A record on a domain you own pointing at `192.168.1.18` so a real
      cert can cover a private IP, or a local CA installed on the phone.

## Operational

- [ ] Change the admin password after first login (bootstrap logs a warning until you do).
- [ ] Static DHCP lease for `192.168.1.18` — compose binds that address explicitly.

## Known gaps

- **Reorder has no UI.** The `reorder` op, the server handler and the sort
  tie-break all work, but Settings has no drag handle to drive it. Manual order
  is only the last tie-break anyway, so this is cosmetic.
- **Reduced-motion covers ticking, not the progress rule.** The tally slash is
  suppressed under `prefers-reduced-motion`, but the header fill still animates
  its width. Small, and nobody has complained yet because nobody has used it.

## From browser review

Chromium at 390pt, light and dark, against a local Postgres. Everything in
Groups A–D of `docs/HANDOFF.md` was worked through; `e2e/` now holds 56 tests
covering the mechanical parts of it, so the next review starts from the visual
judgement rather than from scratch.

### Fixed

- **A4 — the year view opened on the empty past.** 52 columns need ~673px and a
  phone gives ~358, so the grid scrolls. It opened at `scrollLeft: 0`, which is
  the *oldest* end — with 118 days recorded, 18 were on screen and the rest sat
  off to the right behind a wall of blank grid. The design calls this "the
  payoff for keeping `active_days` forever" and it was the one thing you could
  not see. `History.jsx` now scrolls it to the right-hand end on mount, so it
  opens on the present and you drag backwards into the year.

- **A3 — the double rule read as one line.** `.band-end` had its two hairlines
  1px apart, which at phone density is a single slightly-thick rule; the whole
  "above resets nightly, below persists" signal was gone. Now 3px apart.

- **B2 — the confirm sheet promised something the sort does not do.** It said
  skipped exercises "will carry to the **top of your next cycle**". They do not:
  each leads *its own category*, and the categories carrying skip debt float up.
  With three skips in three categories they land at positions 1, 4 and 7. The
  behaviour is right — it is the ordering rules working as designed — so the
  copy changed, to "will come back first next cycle".

- **Touch targets.** Nav tabs were 36px tall and the month arrows 32×32, both
  under the 44px the design sets for itself. Now `var(--tap)`. In Settings,
  `Remove` sat 8px from `Edit` with no undo behind it; the row gap is now 16px.
  The tally marks themselves were already a correct 44×44.

- **The theme choice was signalled by colour alone** and carried no
  `aria-pressed`. Both fixed; the selected option now also gains weight.

### Deliberate, confirmed on screen

- The tally mark works. The slash plus strike-through is unmistakable at arm's
  length, and marked/unmarked is obvious without reading the text. It is worth
  the boldness it spends.
- Category collapse is legible: the struck-through `Back 3/3` under a hairline
  reads as finished rather than missing.
- Both themes hold up; every sampled text/background pair clears 4.5:1.
- Nothing overflows the viewport horizontally, and the fixed nav occludes
  nothing at the bottom of any tab.
- C1–C4 all behave: the offline outbox drains, a tick made mid-flight is not
  swallowed by the batch it missed, a 401 keeps local state, and the session
  survives a server restart.

### Open — needs a decision, not a fix

- **The list re-sorts under your thumb.** Ticking sinks the row within its
  category *and* reorders the categories, so the row below the one you just
  tapped slides up into its place immediately. Mid-workout, one-handed, that is
  a double-tap waiting to happen. The ordering rules are the point of the app so
  the answer is not to stop sorting; the options are to defer the re-sort until
  the view is next opened, or to animate the move so it is legible. Either
  changes `docs/DESIGN.md`, so it is written up rather than fixed.

- **`Remove` uses the browser's native `confirm()`.** It is the only thing in
  the app that does, and it looks nothing like the end-cycle sheet next to it.
  Worth routing through the same sheet component.

- **`cargo build` fails on a host whose `DATABASE_URL` points at an unmigrated
  database** — the sqlx macros check the live schema, and there is no schema
  until the binary runs its migrations, so a fresh clone hits a 40-error wall
  before it can get to that. `SQLX_OFFLINE=true` builds against `.sqlx/` and
  works; the README now says so. A `.cargo/config.toml` setting it by default
  would remove the trap entirely, at the cost of not type-checking new queries
  against a real database unless you unset it.
