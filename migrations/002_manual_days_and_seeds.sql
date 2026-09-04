-- Two additions, both about giving the user control over their own record.
--
-- 1. `active_days.manual` splits "the app decided this day counts" from "I said
--    it counts". Auto rows are recomputed from the logs on every tick, so the
--    threshold can change without stranding old rows; manual rows are never
--    touched by that recompute. See docs/DECISIONS.md.
--
-- 2. `seed_marks` records that a named batch of starter exercises has been
--    offered to a user. Exercises carry a user_id foreign key, so they cannot
--    be seeded by a migration that runs before any user exists -- the seeding
--    itself stays in Rust (src/seed.rs) and this table is what stops it from
--    running twice, or from resurrecting something the user archived.

alter table active_days
    add column manual boolean not null default false;

create table seed_marks (
    user_id    uuid        not null references users (id) on delete cascade,
    seed       text        not null,
    applied_at timestamptz not null default now(),
    primary key (user_id, seed)
);
