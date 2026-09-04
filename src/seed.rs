//! Starter exercises.
//!
//! Exercises carry a `user_id` foreign key, so they cannot be seeded by a
//! migration that runs before any user exists. Seeding therefore lives here
//! and runs at boot; `seed_marks` (migration 002) is what stops it running
//! twice. That guard matters more than it looks: without it every restart
//! would resurrect exercises the user had deliberately archived.

use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

/// Bumping this name re-offers the catalogue to every user exactly once more.
pub const CATALOGUE_SEED: &str = "catalogue-v2";

/// (name, muscle group, cadence).
///
/// `daily` is the band pinned above the rotation: it resets at local midnight
/// and never gates a cycle. Everything else rotates once per cycle.
pub const CATALOGUE: &[(&str, &str, &str)] = &[
    ("Flat bench inner chest", "Chest", "cycle"),
    ("Flat bench chest", "Chest", "cycle"),
    ("Incline bench", "Chest", "cycle"),
    ("Bench fly", "Chest", "cycle"),
    ("Lower pec", "Chest", "cycle"),
    ("Bench over head dumbbell", "Chest", "cycle"),
    ("Dumbell row", "Back", "cycle"),
    ("Deadlift", "Back", "cycle"),
    ("Dumbel row lower", "Back", "cycle"),
    ("Dumbbell row upper", "Back", "cycle"),
    ("Bandcross back", "Back", "cycle"),
    ("Band pull flex", "Back", "cycle"),
    ("Dumbbell back fly", "Back", "cycle"),
    ("Hip thrust", "Back", "cycle"),
    ("Shoulder press", "Shoulders", "cycle"),
    ("Front raise", "Shoulders", "cycle"),
    ("Dumbbell lateral rise", "Shoulders", "cycle"),
    ("Lateral dumbbell rise", "Shoulders", "cycle"),
    ("Steering plate", "Shoulders", "cycle"),
    ("Shrug", "Shoulders", "cycle"),
    ("Squat", "Legs", "cycle"),
    ("Split squat", "Legs", "cycle"),
    ("Lunges", "Legs", "cycle"),
    ("Calf extension", "Legs", "cycle"),
    ("Outer abductor", "Legs", "cycle"),
    ("Curl sitting", "Bi tri", "cycle"),
    ("Overhead triceps", "Bi tri", "cycle"),
    ("Hammer curl", "Bi tri", "cycle"),
    ("Tricep kick back", "Bi tri", "cycle"),
    ("Forearm", "Bi tri", "cycle"),
    ("Diamond push-up", "Bi tri", "cycle"),
    ("Pull up inner", "Bi tri", "cycle"),
    ("Bench triceps", "Bi tri", "cycle"),
    ("Crunches", "Core", "daily"),
    ("Reverse crunches", "Core", "cycle"),
    ("Leg raise", "Core", "cycle"),
    ("Plank", "Core", "daily"),
    ("Plank arm thing", "Core", "cycle"),
    ("Pull up", "Common", "daily"),
    ("Dips", "Common", "daily"),
    ("Squats", "Common", "daily"),
    ("Push up", "Common", "daily"),
];

/// Adds the catalogue to one user, in one transaction with the caller.
///
/// A name that already exists (case-insensitively) is *not* duplicated: its
/// muscle group and cadence are updated to the catalogue's instead, which is
/// what makes "Squats" move from the leg rotation into the daily band without
/// leaving a second copy behind. Anything the user has that the catalogue does
/// not mention is left completely alone.
pub async fn apply_for(conn: &mut PgConnection, user_id: Uuid) -> sqlx::Result<usize> {
    // New rows sort after whatever is already there, so an existing manual
    // order survives the seeding.
    let base: i32 = sqlx::query_scalar!(
        "select coalesce(max(sort_order), -1) + 1 from exercises where user_id = $1",
        user_id
    )
    .fetch_one(&mut *conn)
    .await?
    .unwrap_or(0);

    let mut added = 0;
    for (i, (name, category, cadence)) in CATALOGUE.iter().enumerate() {
        let updated = sqlx::query!(
            "update exercises set category = $1, cadence = $2, archived_at = null
              where user_id = $3 and lower(name) = lower($4)",
            category,
            cadence,
            user_id,
            name
        )
        .execute(&mut *conn)
        .await?
        .rows_affected();

        if updated == 0 {
            sqlx::query!(
                "insert into exercises (user_id, name, category, cadence, sort_order)
                 values ($1, $2, $3, $4, $5)",
                user_id,
                name,
                category,
                cadence,
                base + i as i32
            )
            .execute(&mut *conn)
            .await?;
            added += 1;
        }
    }

    sqlx::query!(
        "insert into seed_marks (user_id, seed) values ($1, $2) on conflict do nothing",
        user_id,
        CATALOGUE_SEED
    )
    .execute(&mut *conn)
    .await?;

    Ok(added)
}

/// Boot hook: applies the catalogue to any user who has not seen it yet.
/// A no-op on every restart after the first.
pub async fn apply_pending(db: &PgPool) -> anyhow::Result<()> {
    let pending: Vec<Uuid> = sqlx::query_scalar!(
        "select id from users u
          where not exists (
              select 1 from seed_marks m
               where m.user_id = u.id and m.seed = $1
          )",
        CATALOGUE_SEED
    )
    .fetch_all(db)
    .await?;

    for user_id in pending {
        let mut tx = db.begin().await?;
        let added = apply_for(&mut tx, user_id).await?;
        tx.commit().await?;
        tracing::info!("seeded {added} new exercises from {CATALOGUE_SEED}");
    }
    Ok(())
}
