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
- **Not visually reviewed.** There was no browser on the host to screenshot
  with, so the UI was built to `docs/DESIGN.md` and verified only through the
  API and the build. Expect spacing and type-scale tweaks on first real use.
