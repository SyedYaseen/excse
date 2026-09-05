-- Optional per-set detail, off by default.
--
-- `users.detailed_entry` is a per-user preference, not a client-local one
-- like theme: it decides whether the entry sheet asks for reps/weight at
-- all, so it has to travel with the account across devices. It rides along
-- on `/api/state` next to `dayThreshold` and `retentionDays`.
--
-- `exercise_logs.reps`/`weight` are nullable and attach to the existing
-- (user, exercise, day) row rather than a new table: this app already logs
-- at most one row per exercise per day (see docs/DECISIONS.md, "repeat on a
-- later day"), so a set's detail belongs on that row, not a separate list of
-- sets. They are pruned with the rest of `exercise_logs` after
-- RETENTION_DAYS -- there is no separate permanence promise for them.

alter table users
    add column detailed_entry boolean not null default false;

alter table exercise_logs
    add column reps   int,
    add column weight real,
    add constraint exercise_logs_reps_positive check (reps is null or reps > 0),
    add constraint exercise_logs_weight_positive check (weight is null or weight > 0);
