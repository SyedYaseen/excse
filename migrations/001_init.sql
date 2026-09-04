-- exse initial schema.
--
-- The load-bearing idea: current-cycle progress lives on the exercise row
-- (exercises.completed_at), NOT in exercise_logs. That keeps exercise_logs a
-- pure disposable history table which can be pruned on a plain date window
-- without ever corrupting cycle state -- even if a cycle outlives the
-- retention window. See docs/DECISIONS.md.

create table users (
    id            uuid primary key default gen_random_uuid(),
    username      text        not null unique,
    password_hash text        not null,
    created_at    timestamptz not null default now()
);

create table sessions (
    token      text        primary key,
    user_id    uuid        not null references users (id) on delete cascade,
    expires_at timestamptz not null,
    created_at timestamptz not null default now()
);
create index sessions_expires_at_idx on sessions (expires_at);

create table exercises (
    -- Client-generated so a row created offline keeps its identity on sync.
    id           uuid primary key default gen_random_uuid(),
    user_id      uuid not null references users (id) on delete cascade,
    name         text not null,
    category     text not null,
    cadence      text not null default 'cycle'
                 check (cadence in ('cycle', 'daily')),
    sort_order   int  not null default 0,
    -- Consecutive cycles this exercise has been skipped by an early end.
    -- Reset to 0 whenever it is completed. Drives sort priority.
    skip_streak  int  not null default 0,
    -- Current-cycle completion, as the client's LOCAL day. NULL = not done
    -- this cycle. Unused for 'daily'.
    --
    -- A date rather than a timestamp because "was this completed today?"
    -- decides whether a tap unticks or logs a repeat, and that question is
    -- only meaningful in the user's timezone. A server timestamp would also
    -- be wrong for a tick made offline and synced days later: it would record
    -- the sync time, not the workout.
    completed_on date,
    -- Soft delete, so historical logs stay resolvable to a name.
    archived_at  timestamptz,
    created_at   timestamptz not null default now()
);
create index exercises_user_idx on exercises (user_id) where archived_at is null;

create table cycles (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references users (id) on delete cascade,
    seq         int  not null,
    started_on  date not null,
    ended_on    date,
    ended_early boolean not null default false,
    done_count  int,
    total_count int,
    unique (user_id, seq)
);
-- At most one open cycle per user.
create unique index cycles_one_open_per_user on cycles (user_id)
    where ended_on is null;

-- Which exercises were left undone when a cycle was ended early. Kept
-- indefinitely; it is tiny and it is the record behind "skipped twice".
create table cycle_skips (
    cycle_id    uuid not null references cycles (id) on delete cascade,
    exercise_id uuid not null references exercises (id) on delete cascade,
    primary key (cycle_id, exercise_id)
);

-- Disposable detail. PRUNED after RETENTION_DAYS.
-- The primary key makes a tick an idempotent fact, so replaying the client
-- outbox after a flaky connection is safe by construction.
create table exercise_logs (
    user_id     uuid not null references users (id) on delete cascade,
    exercise_id uuid not null references exercises (id) on delete cascade,
    day         date not null,
    primary key (user_id, exercise_id, day)
);
create index exercise_logs_day_idx on exercise_logs (day);
create index exercise_logs_user_day_idx on exercise_logs (user_id, day);

-- The permanent fact: "I exercised on this day". NEVER pruned.
-- This is the app's one durability guarantee and the basis of the year view.
create table active_days (
    user_id uuid not null references users (id) on delete cascade,
    day     date not null,
    primary key (user_id, day)
);
