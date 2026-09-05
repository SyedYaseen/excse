use crate::auth::AuthUser;
use crate::error::{AppError, AppResult};
use crate::models::{Cycle, Exercise, LogEntry, Op, State, SyncBody};
use crate::AppState;
use axum::extract::State as AxumState;
use axum::Json;
use chrono::NaiveDate;
use serde::Deserialize;
use sqlx::PgConnection;
use uuid::Uuid;

pub async fn get_state(
    AxumState(state): AxumState<AppState>,
    user: AuthUser,
) -> AppResult<Json<State>> {
    let mut tx = state.db.begin().await?;
    let out = load_state(&mut tx, user.id, state.retention_days, state.day_threshold).await?;
    tx.commit().await?;
    Ok(Json(out))
}

/// TEMP: debug-only full progress wipe for the calling user. Clears history,
/// cycles, and the calendar but leaves the exercise list, account, and
/// session untouched. Remove this route and its Settings button together
/// once asked.
pub async fn reset_progress(
    AxumState(state): AxumState<AppState>,
    user: AuthUser,
) -> AppResult<Json<State>> {
    let mut tx = state.db.begin().await?;

    sqlx::query!("delete from exercise_logs where user_id = $1", user.id)
        .execute(&mut *tx)
        .await?;

    // Cascades into cycle_skips for this user's cycles.
    sqlx::query!("delete from cycles where user_id = $1", user.id)
        .execute(&mut *tx)
        .await?;

    sqlx::query!("delete from active_days where user_id = $1", user.id)
        .execute(&mut *tx)
        .await?;

    sqlx::query!(
        "update exercises set skip_streak = 0, completed_on = null where user_id = $1",
        user.id
    )
    .execute(&mut *tx)
    .await?;

    let out = load_state(&mut tx, user.id, state.retention_days, state.day_threshold).await?;
    tx.commit().await?;
    Ok(Json(out))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsBody {
    pub detailed_entry: bool,
}

/// Account-level preference, not an outbox op: it is not a fact about a
/// workout the way a tick is, and there is nothing to replay offline.
pub async fn update_settings(
    AxumState(state): AxumState<AppState>,
    user: AuthUser,
    Json(body): Json<SettingsBody>,
) -> AppResult<Json<State>> {
    let mut tx = state.db.begin().await?;

    sqlx::query!(
        "update users set detailed_entry = $1 where id = $2",
        body.detailed_entry,
        user.id
    )
    .execute(&mut *tx)
    .await?;

    let out = load_state(&mut tx, user.id, state.retention_days, state.day_threshold).await?;
    tx.commit().await?;
    Ok(Json(out))
}

pub async fn sync(
    AxumState(state): AxumState<AppState>,
    user: AuthUser,
    Json(body): Json<SyncBody>,
) -> AppResult<Json<State>> {
    let mut tx = state.db.begin().await?;

    // Applied in array order inside one transaction, so an UpsertExercise
    // always lands before a Tick that references it. Any failure rolls the
    // whole batch back and the client keeps its outbox.
    for op in &body.ops {
        apply(&mut tx, user.id, op, state.day_threshold).await?;
    }

    let out = load_state(&mut tx, user.id, state.retention_days, state.day_threshold).await?;
    tx.commit().await?;
    Ok(Json(out))
}

/// The client is the authority on what "today" is, because the server runs in
/// UTC and a 21:00 workout would otherwise be filed under tomorrow. We only
/// reject dates far enough in the future to be corruption rather than a
/// timezone ahead of UTC.
fn check_day(day: NaiveDate) -> AppResult<()> {
    let limit = chrono::Utc::now().date_naive() + chrono::Duration::days(1);
    if day > limit {
        return Err(AppError::BadRequest(format!(
            "date {day} is too far in the future"
        )));
    }
    Ok(())
}

async fn apply(
    conn: &mut PgConnection,
    user_id: Uuid,
    op: &Op,
    day_threshold: i32,
) -> AppResult<()> {
    match op {
        Op::Tick { exercise_id, day, reps, weight } => {
            check_day(*day)?;
            let ex = owned_exercise(conn, user_id, *exercise_id).await?;

            sqlx::query!(
                "insert into exercise_logs (user_id, exercise_id, day)
                 values ($1, $2, $3) on conflict do nothing",
                user_id,
                exercise_id,
                day
            )
            .execute(&mut *conn)
            .await?;

            // A separate, conditional update rather than folding reps/weight
            // into the insert above: a plain tap (no detail) replaying
            // against an already-logged day must not wipe values a detailed
            // entry recorded earlier, and `coalesce($1, col)` here means a
            // later edit -- dispatched as another tick for the same day --
            // updates them in place without touching the other.
            if reps.is_some() || weight.is_some() {
                sqlx::query!(
                    "update exercise_logs
                        set reps = coalesce($1, reps), weight = coalesce($2, weight)
                      where user_id = $3 and exercise_id = $4 and day = $5",
                    *reps,
                    *weight,
                    user_id,
                    exercise_id,
                    day
                )
                .execute(&mut *conn)
                .await?;
            }

            recount_day(&mut *conn, user_id, *day, day_threshold).await?;

            // Only the first completion in a cycle sets completed_on. Ticking
            // an already-done exercise again later in the same cycle is a
            // repeat occurrence: it logs the day but leaves cycle state alone.
            if ex.cadence == "cycle" && ex.completed_on.is_none() {
                sqlx::query!(
                    "update exercises set completed_on = $1 where id = $2",
                    day,
                    exercise_id
                )
                .execute(&mut *conn)
                .await?;
            }
        }

        Op::Untick { exercise_id, day } => {
            check_day(*day)?;
            let ex = owned_exercise(conn, user_id, *exercise_id).await?;

            sqlx::query!(
                "delete from exercise_logs
                  where user_id = $1 and exercise_id = $2 and day = $3",
                user_id,
                exercise_id,
                day
            )
            .execute(&mut *conn)
            .await?;

            // active_days is permanent, but a mis-tap must not leave behind a
            // workout that never happened. Re-derive the day from what is
            // actually logged against it now.
            recount_day(&mut *conn, user_id, *day, day_threshold).await?;

            // Only clear cycle completion if the tick being removed is the one
            // that completed it. Unticking a later repeat leaves it done.
            if ex.cadence == "cycle" && ex.completed_on == Some(*day) {
                sqlx::query!(
                    "update exercises set completed_on = null where id = $1",
                    exercise_id
                )
                .execute(&mut *conn)
                .await?;
            }
        }

        Op::EndCycle { day } => {
            check_day(*day)?;
            let cycle = ensure_cycle(conn, user_id, *day).await?;

            // Daily staples are never "skipped" and archived exercises never
            // block completion, so both are excluded from every count here.
            let counts = sqlx::query!(
                "select count(*) as total,
                        count(completed_on) as done
                   from exercises
                  where user_id = $1 and cadence = 'cycle' and archived_at is null",
                user_id
            )
            .fetch_one(&mut *conn)
            .await?;
            let total = counts.total.unwrap_or(0) as i32;
            let done = counts.done.unwrap_or(0) as i32;

            sqlx::query!(
                "insert into cycle_skips (cycle_id, exercise_id)
                 select $1, id from exercises
                  where user_id = $2 and cadence = 'cycle'
                    and archived_at is null and completed_on is null
                 on conflict do nothing",
                cycle.id,
                user_id
            )
            .execute(&mut *conn)
            .await?;

            // Skipping is a streak: it compounds across cycles so a repeatedly
            // dodged exercise climbs to the top. Completing it clears the debt.
            sqlx::query!(
                "update exercises
                    set skip_streak = case
                            when completed_on is null then skip_streak + 1
                            else 0
                        end
                  where user_id = $1 and cadence = 'cycle' and archived_at is null",
                user_id
            )
            .execute(&mut *conn)
            .await?;

            sqlx::query!(
                "update exercises set completed_on = null where user_id = $1",
                user_id
            )
            .execute(&mut *conn)
            .await?;

            sqlx::query!(
                "update cycles
                    set ended_on = $1, ended_early = $2, done_count = $3, total_count = $4
                  where id = $5",
                day,
                done < total,
                done,
                total,
                cycle.id
            )
            .execute(&mut *conn)
            .await?;

            sqlx::query!(
                "insert into cycles (user_id, seq, started_on) values ($1, $2, $3)",
                user_id,
                cycle.seq + 1,
                day
            )
            .execute(&mut *conn)
            .await?;
        }

        Op::UpsertExercise {
            id,
            name,
            category,
            cadence,
            sort_order,
        } => {
            if cadence != "cycle" && cadence != "daily" {
                return Err(AppError::BadRequest(format!("unknown cadence {cadence}")));
            }
            let name = name.trim();
            if name.is_empty() {
                return Err(AppError::BadRequest("Give the exercise a name.".into()));
            }

            // The where clause on the update arm stops a client-generated id
            // from hijacking another user's row.
            sqlx::query!(
                "insert into exercises (id, user_id, name, category, cadence, sort_order)
                 values ($1, $2, $3, $4, $5, $6)
                 on conflict (id) do update
                    set name = excluded.name,
                        category = excluded.category,
                        cadence = excluded.cadence,
                        sort_order = excluded.sort_order,
                        archived_at = null
                  where exercises.user_id = $2",
                id,
                user_id,
                name,
                category.trim(),
                cadence,
                sort_order
            )
            .execute(&mut *conn)
            .await?;
        }

        Op::ArchiveExercise { id } => {
            // Soft delete: historical logs must stay resolvable to a name.
            sqlx::query!(
                "update exercises set archived_at = now()
                  where id = $1 and user_id = $2 and archived_at is null",
                id,
                user_id
            )
            .execute(&mut *conn)
            .await?;
        }

        Op::Reorder { ids } => {
            for (i, id) in ids.iter().enumerate() {
                sqlx::query!(
                    "update exercises set sort_order = $1 where id = $2 and user_id = $3",
                    i as i32,
                    id,
                    user_id
                )
                .execute(&mut *conn)
                .await?;
            }
        }

        Op::MarkDay { day, marked } => {
            check_day(*day)?;

            if *marked {
                sqlx::query!(
                    "insert into active_days (user_id, day, manual) values ($1, $2, true)
                     on conflict (user_id, day) do update set manual = true",
                    user_id,
                    day
                )
                .execute(&mut *conn)
                .await?;
            } else {
                // Clearing the override, not deleting the day: if the logs
                // still earn it, it stays. Only a day that was propped up by
                // hand actually disappears.
                sqlx::query!(
                    "update active_days set manual = false where user_id = $1 and day = $2",
                    user_id,
                    day
                )
                .execute(&mut *conn)
                .await?;
                recount_day(&mut *conn, user_id, *day, day_threshold).await?;
            }
        }
    }
    Ok(())
}

/// Decides whether a day belongs on the calendar, from scratch.
///
/// The rule is a count of *rotation* exercises: the daily band is excluded, so
/// crunches and a plank on their own leave the day blank. Four squats-and-press
/// sessions' worth of work is what a day is, and the threshold is
/// `DAY_MIN_EXERCISES`.
///
/// Recomputing rather than incrementing means the threshold can be changed
/// later without stranding rows that were written under the old one, and it
/// makes tick/untick symmetric for free. A day the user marked by hand carries
/// `manual` and is never removed here -- only `Op::MarkDay` clears that.
async fn recount_day(
    conn: &mut PgConnection,
    user_id: Uuid,
    day: NaiveDate,
    threshold: i32,
) -> AppResult<()> {
    let logged: i64 = sqlx::query_scalar!(
        "select count(*) from exercise_logs l
           join exercises e on e.id = l.exercise_id
          where l.user_id = $1 and l.day = $2 and e.cadence = 'cycle'",
        user_id,
        day
    )
    .fetch_one(&mut *conn)
    .await?
    .unwrap_or(0);

    if logged >= threshold as i64 {
        sqlx::query!(
            "insert into active_days (user_id, day) values ($1, $2)
             on conflict do nothing",
            user_id,
            day
        )
        .execute(&mut *conn)
        .await?;
    } else {
        sqlx::query!(
            "delete from active_days where user_id = $1 and day = $2 and not manual",
            user_id,
            day
        )
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

struct OwnedExercise {
    cadence: String,
    completed_on: Option<NaiveDate>,
}

async fn owned_exercise(
    conn: &mut PgConnection,
    user_id: Uuid,
    id: Uuid,
) -> AppResult<OwnedExercise> {
    sqlx::query_as!(
        OwnedExercise,
        "select cadence, completed_on from exercises
          where id = $1 and user_id = $2 and archived_at is null",
        id,
        user_id
    )
    .fetch_optional(&mut *conn)
    .await?
    .ok_or_else(|| AppError::BadRequest("no such exercise".into()))
}

/// There must always be an open cycle. Opening one lazily means the app can
/// never land in a state with nothing to tick against.
async fn ensure_cycle(conn: &mut PgConnection, user_id: Uuid, today: NaiveDate) -> AppResult<Cycle> {
    if let Some(c) = sqlx::query_as!(
        Cycle,
        "select id, seq, started_on, ended_on, ended_early, done_count, total_count
           from cycles where user_id = $1 and ended_on is null",
        user_id
    )
    .fetch_optional(&mut *conn)
    .await?
    {
        return Ok(c);
    }

    let next: i32 = sqlx::query_scalar!(
        "select coalesce(max(seq), 0) + 1 from cycles where user_id = $1",
        user_id
    )
    .fetch_one(&mut *conn)
    .await?
    .unwrap_or(1);

    let c = sqlx::query_as!(
        Cycle,
        "insert into cycles (user_id, seq, started_on) values ($1, $2, $3)
         returning id, seq, started_on, ended_on, ended_early, done_count, total_count",
        user_id,
        next,
        today
    )
    .fetch_one(&mut *conn)
    .await?;
    Ok(c)
}

async fn load_state(
    conn: &mut PgConnection,
    user_id: Uuid,
    retention_days: i32,
    day_threshold: i32,
) -> AppResult<State> {
    let today = chrono::Utc::now().date_naive();
    let cycle = ensure_cycle(&mut *conn, user_id, today).await?;

    let exercises = sqlx::query_as!(
        Exercise,
        "select id, name, category, cadence, sort_order, skip_streak, completed_on
           from exercises
          where user_id = $1 and archived_at is null
          order by sort_order, name",
        user_id
    )
    .fetch_all(&mut *conn)
    .await?;

    let past_cycles = sqlx::query_as!(
        Cycle,
        "select id, seq, started_on, ended_on, ended_early, done_count, total_count
           from cycles
          where user_id = $1 and ended_on is not null
          order by seq desc
          limit 50",
        user_id
    )
    .fetch_all(&mut *conn)
    .await?;

    let logs = sqlx::query_as!(
        LogEntry,
        "select exercise_id, day, reps, weight from exercise_logs
          where user_id = $1 and day >= current_date - $2::int
          order by day",
        user_id,
        retention_days
    )
    .fetch_all(&mut *conn)
    .await?;

    let detailed_entry = sqlx::query_scalar!(
        "select detailed_entry from users where id = $1",
        user_id
    )
    .fetch_one(&mut *conn)
    .await?;

    // Every day ever, deliberately unbounded: this is the record the whole app
    // exists to keep. ~365 short rows a year is a few KB on the wire.
    let active_days = sqlx::query_scalar!(
        "select day from active_days where user_id = $1 order by day",
        user_id
    )
    .fetch_all(&mut *conn)
    .await?;

    // The subset that was marked by hand. The client needs the distinction to
    // know whether unmarking a day will actually remove it, or whether the
    // logs earn it regardless.
    let manual_days = sqlx::query_scalar!(
        "select day from active_days where user_id = $1 and manual order by day",
        user_id
    )
    .fetch_all(&mut *conn)
    .await?;

    Ok(State {
        exercises,
        cycle,
        past_cycles,
        logs,
        active_days,
        manual_days,
        retention_days,
        day_threshold,
        detailed_entry,
    })
}
