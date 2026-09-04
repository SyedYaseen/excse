use sqlx::PgPool;
use std::time::Duration;

/// Drops per-exercise detail older than the retention window.
///
/// This is safe to run at any time precisely because current-cycle progress
/// lives on `exercises.completed_on` rather than being derived from these
/// rows -- a cycle that outlives the window keeps its state. `active_days` is
/// never touched: "I exercised that day" is the one fact kept forever.
///
/// Server-side `current_date` is fine here even though the client owns "today"
/// everywhere else; a few hours of drift against a 21-day window is noise.
pub async fn prune(db: &PgPool, retention_days: i32) -> Result<u64, sqlx::Error> {
    let deleted = sqlx::query!(
        "delete from exercise_logs where day < current_date - $1::int",
        retention_days
    )
    .execute(db)
    .await?
    .rows_affected();

    // Expired sessions are pure garbage once past their expiry; the extractor
    // already refuses them.
    sqlx::query!("delete from sessions where expires_at < now()")
        .execute(db)
        .await?;

    Ok(deleted)
}

/// Runs once at boot, then daily.
pub fn spawn(db: PgPool, retention_days: i32) {
    tokio::spawn(async move {
        loop {
            match prune(&db, retention_days).await {
                Ok(n) if n > 0 => tracing::info!("pruned {n} log rows older than {retention_days}d"),
                Ok(_) => tracing::debug!("nothing to prune"),
                Err(e) => tracing::error!(error = ?e, "prune failed"),
            }
            tokio::time::sleep(Duration::from_secs(24 * 60 * 60)).await;
        }
    });
}
