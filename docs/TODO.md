# TODO

Living checklist. Each step is one commit. Update as things land so this can be picked up cold.

## Build order

- [x] 1. Scaffold — `Cargo.toml`, `web/` Vite+React skeleton, `.gitignore`, docs
- [ ] 2. `001_init.sql`; create `exse` role/database; pool + `sqlx::migrate!` on boot
- [ ] 3. `auth.rs` — argon2, sessions, `AuthUser` extractor, login/logout/me, bootstrap txn
- [ ] 4. `models.rs` + `routes/state.rs` — `GET /api/state`, `POST /api/sync`, one transaction
- [ ] 5. `retention.rs` prune task + `active_days` upsert path
- [ ] 6. Client core — `store.js`, `dates.js`, `api.js`, `sync.js`, outbox + unsynced indicator
- [ ] 7. `sort.js` + unit tests for the ordering rules
- [ ] 8. Design foundation — Archivo woff2, `theme.css` tokens, `TallyMark` + tick animation
- [ ] 9. UI — progress rule, daily band, Rotation/CategoryGroup/ExerciseRow, collapse
- [ ] 10. CycleButton + EndCycleSheet incl. early-end skip flow
- [ ] 11. History — month calendar, 52×7 year tally, streaks, cycle summaries
- [ ] 12. Light/dark toggle, reduced motion, mobile polish
- [ ] 13. Settings — manage exercises, cadence toggle, reorder, change password
- [ ] 14. Dockerfile + docker-compose + README

## Deferred (consciously cut from v1)

- [ ] **PWA layer** — `vite-plugin-pwa`, manifest, maskable icons, offline app shell.
- [ ] **HTTPS** — prerequisite for the above; service workers need a secure context.
      Options: a DNS-only A record on a domain you own pointing at `192.168.1.18` so a real
      cert can cover a private IP, or a local CA installed on the phone.

## Operational

- [ ] Change the admin password after first login (bootstrap logs a warning until you do).
- [ ] Static DHCP lease for `192.168.1.18` — compose binds that address explicitly.
