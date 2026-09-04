use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Exercise {
    pub id: Uuid,
    pub name: String,
    pub category: String,
    pub cadence: String,
    pub sort_order: i32,
    pub skip_streak: i32,
    pub completed_on: Option<NaiveDate>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Cycle {
    pub id: Uuid,
    pub seq: i32,
    pub started_on: NaiveDate,
    pub ended_on: Option<NaiveDate>,
    pub ended_early: bool,
    pub done_count: Option<i32>,
    pub total_count: Option<i32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub exercise_id: Uuid,
    pub day: NaiveDate,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    pub exercises: Vec<Exercise>,
    pub cycle: Cycle,
    /// Past cycles, newest first. Small and kept indefinitely.
    pub past_cycles: Vec<Cycle>,
    /// Detailed history, only as far back as RETENTION_DAYS.
    pub logs: Vec<LogEntry>,
    /// Every day the user exercised, ever. Never pruned.
    pub active_days: Vec<NaiveDate>,
    pub retention_days: i32,
}

/// One user intent. The client appends these to an outbox and replays them;
/// every variant is idempotent so a replay after a dropped connection is safe.
#[derive(Deserialize, Debug)]
// rename_all covers the variant names; rename_all_fields is separately needed
// for the fields inside them, or `exerciseId` fails to deserialize.
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Op {
    Tick {
        exercise_id: Uuid,
        day: NaiveDate,
    },
    Untick {
        exercise_id: Uuid,
        day: NaiveDate,
    },
    /// Closes the open cycle and opens the next. Whether it counts as "early"
    /// is derived from the actual counts, never taken from the client.
    EndCycle {
        day: NaiveDate,
    },
    UpsertExercise {
        id: Uuid,
        name: String,
        category: String,
        cadence: String,
        sort_order: i32,
    },
    ArchiveExercise {
        id: Uuid,
    },
    Reorder {
        ids: Vec<Uuid>,
    },
}

#[derive(Deserialize)]
pub struct SyncBody {
    pub ops: Vec<Op>,
}
