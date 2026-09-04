//! Integration tests over the real HTTP surface.
//!
//! Each test gets its own ephemeral database from `#[sqlx::test]`, which also
//! applies `migrations/`. Covers the rules in docs/PLAN.md "Correctness
//! details" -- every one of them is a bug if implemented naively.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum_extra::extract::cookie::Key;
use chrono::{Duration, NaiveDate, Utc};
use exse::{api_router, auth, seed, AppState};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use sqlx::PgPool;
use tower::ServiceExt;

const TEST_PASSWORD: &str = "correct horse battery";

/// The real default is 4. Two keeps the fixtures small while still testing
/// that a day has to be earned by more than one tick.
const THRESHOLD: i32 = 2;

/// How many exercises `bootstrap` seeds.
fn seeded() -> usize {
    seed::CATALOGUE.len()
}

/// How many of those rotate once per cycle. The daily band never gates one.
fn seeded_rotation() -> i64 {
    seed::CATALOGUE.iter().filter(|(_, _, c)| *c == "cycle").count() as i64
}

struct Api {
    router: axum::Router,
    cookie: String,
    db: PgPool,
}

impl Api {
    async fn new(db: PgPool) -> Self {
        auth::bootstrap(&db, Some(TEST_PASSWORD)).await.unwrap();

        let state = AppState {
            db: db.clone(),
            retention_days: 21,
            day_threshold: THRESHOLD,
            cookie_secure: false,
            cookie_key: Key::from(&[7u8; 64]),
        };
        let router = api_router(state);

        let res = router
            .clone()
            .oneshot(
                Request::post("/api/login")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({"username":"admin","password":TEST_PASSWORD}).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), StatusCode::OK, "bootstrap login failed");

        let cookie = res
            .headers()
            .get("set-cookie")
            .expect("login set no cookie")
            .to_str()
            .unwrap()
            .split(';')
            .next()
            .unwrap()
            .to_string();

        Api { router, cookie, db }
    }

    async fn call(&self, method: &str, uri: &str, body: Option<Value>) -> (StatusCode, Value) {
        let req = Request::builder()
            .method(method)
            .uri(uri)
            .header("cookie", &self.cookie)
            .header("content-type", "application/json");
        let req = match body {
            Some(b) => req.body(Body::from(b.to_string())).unwrap(),
            None => req.body(Body::empty()).unwrap(),
        };

        let res = self.router.clone().oneshot(req).await.unwrap();
        let status = res.status();
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        let value: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        (status, value)
    }

    async fn state(&self) -> Value {
        let (s, v) = self.call("GET", "/api/state", None).await;
        assert_eq!(s, StatusCode::OK);
        v
    }

    async fn sync(&self, ops: Value) -> Value {
        let (s, v) = self.call("POST", "/api/sync", Some(json!({ "ops": ops }))).await;
        assert_eq!(s, StatusCode::OK, "sync failed: {v}");
        v
    }

    /// First non-daily exercise in the named category.
    async fn cycle_exercise(&self, category: &str) -> String {
        let st = self.state().await;
        st["exercises"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["category"] == category && e["cadence"] == "cycle")
            .expect("no such category")["id"]
            .as_str()
            .unwrap()
            .to_string()
    }

    async fn user_id(&self, db: &PgPool) -> uuid::Uuid {
        sqlx::query_scalar("select id from users where username = 'admin'")
            .fetch_one(db)
            .await
            .unwrap()
    }

    async fn daily_exercise(&self) -> String {
        let st = self.state().await;
        st["exercises"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["cadence"] == "daily")
            .expect("no daily exercise")["id"]
            .as_str()
            .unwrap()
            .to_string()
    }
}

fn today() -> NaiveDate {
    Utc::now().date_naive()
}

fn days_ago(n: i64) -> NaiveDate {
    today() - Duration::days(n)
}

fn active_days(state: &Value) -> Vec<String> {
    state["activeDays"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d.as_str().unwrap().to_string())
        .collect()
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

#[sqlx::test]
async fn bootstrap_creates_admin_exercises_and_first_cycle(db: PgPool) {
    let api = Api::new(db.clone()).await;
    let st = api.state().await;

    assert_eq!(st["exercises"].as_array().unwrap().len(), seeded());
    assert_eq!(st["cycle"]["seq"], 1);
    assert!(st["exercises"]
        .as_array()
        .unwrap()
        .iter()
        .any(|e| e["cadence"] == "daily"));

    // Running it again must not duplicate anything.
    auth::bootstrap(&db, Some("another")).await.unwrap();
    let users: i64 = sqlx::query_scalar("select count(*) from users")
        .fetch_one(&db)
        .await
        .unwrap();
    let exercises: i64 = sqlx::query_scalar("select count(*) from exercises")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(users, 1);
    assert_eq!(exercises, seeded() as i64);
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

#[sqlx::test]
async fn state_requires_auth(db: PgPool) {
    let api = Api::new(db).await;
    let res = api
        .router
        .clone()
        .oneshot(Request::get("/api/state").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[sqlx::test]
async fn logout_revokes_the_session(db: PgPool) {
    let api = Api::new(db).await;
    let (s, _) = api.call("POST", "/api/logout", None).await;
    assert_eq!(s, StatusCode::OK);

    let (s, _) = api.call("GET", "/api/state", None).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED, "session survived logout");
}

// ---------------------------------------------------------------------------
// Ticking
// ---------------------------------------------------------------------------

#[sqlx::test]
async fn tick_records_log_and_cycle_progress(db: PgPool) {
    let api = Api::new(db).await;
    let id = api.cycle_exercise("Back").await;

    let st = api
        .sync(json!([{"type":"tick","exerciseId":id,"day":today()}]))
        .await;

    assert_eq!(st["logs"].as_array().unwrap().len(), 1);
    assert!(
        active_days(&st).is_empty(),
        "a single tick claimed a whole day"
    );
    assert_eq!(st["dayThreshold"], THRESHOLD);

    let ex = st["exercises"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == id.as_str())
        .unwrap()
        .clone();
    assert_eq!(ex["completedOn"], today().to_string());
}

#[sqlx::test]
async fn ticking_twice_is_idempotent(db: PgPool) {
    let api = Api::new(db).await;
    let id = api.cycle_exercise("Back").await;
    let op = json!([{"type":"tick","exerciseId":id,"day":today()}]);

    api.sync(op.clone()).await;
    let st = api.sync(op).await;

    assert_eq!(st["logs"].as_array().unwrap().len(), 1);
    assert!(active_days(&st).is_empty(), "a repeat inflated the count");
}

// ---------------------------------------------------------------------------
// What makes a day count
// ---------------------------------------------------------------------------

#[sqlx::test]
async fn a_day_is_earned_by_the_threshold_not_by_one_tick(db: PgPool) {
    let api = Api::new(db).await;
    let a = api.cycle_exercise("Back").await;
    let b = api.cycle_exercise("Chest").await;

    let st = api
        .sync(json!([{"type":"tick","exerciseId":a,"day":today()}]))
        .await;
    assert!(active_days(&st).is_empty());

    let st = api
        .sync(json!([{"type":"tick","exerciseId":b,"day":today()}]))
        .await;
    assert_eq!(active_days(&st), vec![today().to_string()]);
}

#[sqlx::test]
async fn the_daily_band_never_counts_towards_a_day(db: PgPool) {
    let api = Api::new(db).await;
    let st = api.state().await;
    let dailies: Vec<String> = st["exercises"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["cadence"] == "daily")
        .map(|e| e["id"].as_str().unwrap().to_string())
        .collect();
    assert!(
        dailies.len() > THRESHOLD as usize,
        "need more dailies than the threshold to prove they do not count"
    );

    let ops: Vec<Value> = dailies
        .iter()
        .map(|id| json!({"type":"tick","exerciseId":id,"day":today()}))
        .collect();
    let st = api.sync(json!(ops)).await;

    assert!(
        active_days(&st).is_empty(),
        "the daily band alone marked a workout"
    );
}

#[sqlx::test]
async fn marking_a_day_by_hand_overrides_the_threshold(db: PgPool) {
    let api = Api::new(db).await;

    let st = api
        .sync(json!([{"type":"markDay","day":days_ago(3),"marked":true}]))
        .await;
    assert_eq!(active_days(&st), vec![days_ago(3).to_string()]);
    assert_eq!(
        st["manualDays"].as_array().unwrap().len(),
        1,
        "the override was not recorded"
    );

    // A tick and untick on that day must not recount the override away.
    let id = api.cycle_exercise("Back").await;
    api.sync(json!([{"type":"tick","exerciseId":id,"day":days_ago(3)}]))
        .await;
    let st = api
        .sync(json!([{"type":"untick","exerciseId":id,"day":days_ago(3)}]))
        .await;
    assert_eq!(
        active_days(&st),
        vec![days_ago(3).to_string()],
        "a hand-marked day was recounted away"
    );

    let st = api
        .sync(json!([{"type":"markDay","day":days_ago(3),"marked":false}]))
        .await;
    assert!(active_days(&st).is_empty(), "unmarking did not remove it");
}

#[sqlx::test]
async fn unmarking_keeps_a_day_the_logs_still_earn(db: PgPool) {
    let api = Api::new(db).await;
    let a = api.cycle_exercise("Back").await;
    let b = api.cycle_exercise("Chest").await;

    api.sync(json!([
        {"type":"tick","exerciseId":a,"day":today()},
        {"type":"tick","exerciseId":b,"day":today()},
    ]))
    .await;

    let st = api
        .sync(json!([{"type":"markDay","day":today(),"marked":false}]))
        .await;
    assert_eq!(
        active_days(&st),
        vec![today().to_string()],
        "a day that was actually trained was erased"
    );
    assert!(st["manualDays"].as_array().unwrap().is_empty());
}

#[sqlx::test]
async fn daily_tick_never_touches_cycle_progress(db: PgPool) {
    let api = Api::new(db).await;
    let id = api.daily_exercise().await;

    let st = api
        .sync(json!([{"type":"tick","exerciseId":id,"day":today()}]))
        .await;

    let ex = st["exercises"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == id.as_str())
        .unwrap()
        .clone();
    assert_eq!(ex["completedOn"], Value::Null, "daily set cycle progress");
    assert_eq!(st["logs"].as_array().unwrap().len(), 1);
}

// ---------------------------------------------------------------------------
// Unticking -- the active_days retraction rule
// ---------------------------------------------------------------------------

#[sqlx::test]
async fn untick_retracts_the_active_day_once_it_drops_below_the_threshold(db: PgPool) {
    let api = Api::new(db).await;
    let id = api.cycle_exercise("Back").await;
    let other = api.cycle_exercise("Chest").await;

    api.sync(json!([
        {"type":"tick","exerciseId":id,"day":today()},
        {"type":"tick","exerciseId":other,"day":today()},
    ]))
    .await;
    let st = api
        .sync(json!([{"type":"untick","exerciseId":id,"day":today()}]))
        .await;

    assert!(
        active_days(&st).is_empty(),
        "a mis-tap left a permanent workout behind"
    );
    let ex = st["exercises"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == id.as_str())
        .unwrap()
        .clone();
    assert_eq!(ex["completedOn"], Value::Null);
}

#[sqlx::test]
async fn untick_keeps_the_active_day_when_enough_still_remains(db: PgPool) {
    let api = Api::new(db).await;
    let a = api.cycle_exercise("Back").await;
    let b = api.cycle_exercise("Chest").await;
    let c = api.cycle_exercise("Shoulders").await;

    api.sync(json!([
        {"type":"tick","exerciseId":a,"day":today()},
        {"type":"tick","exerciseId":b,"day":today()},
        {"type":"tick","exerciseId":c,"day":today()},
    ]))
    .await;

    let st = api
        .sync(json!([{"type":"untick","exerciseId":a,"day":today()}]))
        .await;

    assert_eq!(
        active_days(&st),
        vec![today().to_string()],
        "the day was retracted despite another exercise still logged"
    );
}

// ---------------------------------------------------------------------------
// Repeating an exercise later in the same cycle
// ---------------------------------------------------------------------------

#[sqlx::test]
async fn repeat_on_a_later_day_logs_without_changing_cycle_state(db: PgPool) {
    let api = Api::new(db).await;
    let id = api.cycle_exercise("Back").await;
    let other = api.cycle_exercise("Chest").await;

    api.sync(json!([
        {"type":"tick","exerciseId":id,"day":days_ago(2)},
        {"type":"tick","exerciseId":other,"day":days_ago(2)},
    ]))
    .await;
    let st = api
        .sync(json!([
            {"type":"tick","exerciseId":id,"day":today()},
            {"type":"tick","exerciseId":other,"day":today()},
        ]))
        .await;

    assert_eq!(st["logs"].as_array().unwrap().len(), 4);
    assert_eq!(
        active_days(&st),
        vec![days_ago(2).to_string(), today().to_string()],
        "the repeat day was not recorded"
    );

    let ex = st["exercises"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == id.as_str())
        .unwrap()
        .clone();
    assert_eq!(
        ex["completedOn"],
        days_ago(2).to_string(),
        "a repeat moved the original completion date"
    );
}

#[sqlx::test]
async fn unticking_a_repeat_leaves_the_original_completion(db: PgPool) {
    let api = Api::new(db).await;
    let id = api.cycle_exercise("Back").await;

    api.sync(json!([
        {"type":"tick","exerciseId":id,"day":days_ago(2)},
        {"type":"tick","exerciseId":id,"day":today()},
    ]))
    .await;
    let st = api
        .sync(json!([{"type":"untick","exerciseId":id,"day":today()}]))
        .await;

    let ex = st["exercises"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == id.as_str())
        .unwrap()
        .clone();
    assert_eq!(
        ex["completedOn"],
        days_ago(2).to_string(),
        "removing a repeat wrongly cleared cycle completion"
    );
}

// ---------------------------------------------------------------------------
// Ending a cycle
// ---------------------------------------------------------------------------

#[sqlx::test]
async fn ending_early_records_skips_and_carries_them_forward(db: PgPool) {
    let api = Api::new(db).await;
    let done = api.cycle_exercise("Back").await;

    api.sync(json!([{"type":"tick","exerciseId":done,"day":today()}]))
        .await;
    let st = api.sync(json!([{"type":"endCycle","day":today()}])).await;

    assert_eq!(st["cycle"]["seq"], 2, "next cycle did not open");
    let past = &st["pastCycles"][0];
    assert_eq!(past["endedEarly"], true);
    assert_eq!(past["doneCount"], 1);
    assert_eq!(
        past["totalCount"],
        seeded_rotation(),
        "the daily band was counted into the cycle"
    );

    for ex in st["exercises"].as_array().unwrap() {
        assert_eq!(ex["completedOn"], Value::Null, "progress survived the reset");

        if ex["cadence"] == "daily" {
            assert_eq!(ex["skipStreak"], 0, "a daily was penalised as skipped");
        } else if ex["id"] == done.as_str() {
            assert_eq!(ex["skipStreak"], 0, "a completed exercise gained skip debt");
        } else {
            assert_eq!(ex["skipStreak"], 1, "a skipped exercise gained no debt");
        }
    }

    let skips: i64 = sqlx::query_scalar("select count(*) from cycle_skips")
        .fetch_one(&api.db)
        .await
        .unwrap();
    assert_eq!(skips, seeded_rotation() - 1, "one was done; the rest carry");
}

#[sqlx::test]
async fn skip_streaks_compound_then_clear_on_completion(db: PgPool) {
    let api = Api::new(db).await;
    let id = api.cycle_exercise("Back").await;

    api.sync(json!([{"type":"endCycle","day":today()}])).await;
    let st = api.sync(json!([{"type":"endCycle","day":today()}])).await;

    let streak = st["exercises"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == id.as_str())
        .unwrap()["skipStreak"]
        .clone();
    assert_eq!(streak, 2, "skip debt did not compound across cycles");

    api.sync(json!([{"type":"tick","exerciseId":id,"day":today()}]))
        .await;
    let st = api.sync(json!([{"type":"endCycle","day":today()}])).await;

    let streak = st["exercises"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == id.as_str())
        .unwrap()["skipStreak"]
        .clone();
    assert_eq!(streak, 0, "completing it did not clear the debt");
}

#[sqlx::test]
async fn a_full_cycle_is_not_marked_early(db: PgPool) {
    let api = Api::new(db).await;
    let st = api.state().await;

    let ops: Vec<Value> = st["exercises"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["cadence"] == "cycle")
        .map(|e| json!({"type":"tick","exerciseId":e["id"],"day":today()}))
        .collect();
    api.sync(json!(ops)).await;

    let st = api.sync(json!([{"type":"endCycle","day":today()}])).await;
    let past = &st["pastCycles"][0];
    assert_eq!(past["endedEarly"], false);
    assert_eq!(past["doneCount"], past["totalCount"]);
}

#[sqlx::test]
async fn archived_exercises_do_not_block_or_accrue_skips(db: PgPool) {
    let api = Api::new(db).await;
    let id = api.cycle_exercise("Back").await;

    api.sync(json!([{"type":"archiveExercise","id":id}])).await;
    let st = api.sync(json!([{"type":"endCycle","day":today()}])).await;

    assert_eq!(
        st["pastCycles"][0]["totalCount"],
        seeded_rotation() - 1,
        "an archived exercise still counted toward the cycle"
    );
    assert!(
        !st["exercises"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["id"] == id.as_str()),
        "archived exercise still returned"
    );

    let streak: i32 = sqlx::query_scalar("select skip_streak from exercises where id = $1")
        .bind(uuid::Uuid::parse_str(&id).unwrap())
        .fetch_one(&api.db)
        .await
        .unwrap();
    assert_eq!(streak, 0, "an archived exercise accrued skip debt");
}

// ---------------------------------------------------------------------------
// Date handling
// ---------------------------------------------------------------------------

#[sqlx::test]
async fn far_future_dates_are_rejected_but_yesterday_is_fine(db: PgPool) {
    let api = Api::new(db).await;
    let id = api.cycle_exercise("Back").await;

    let (s, _) = api
        .call(
            "POST",
            "/api/sync",
            Some(json!({"ops":[{"type":"tick","exerciseId":id,"day":today() + Duration::days(3)}]})),
        )
        .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    let other = api.cycle_exercise("Chest").await;
    let st = api
        .sync(json!([
            {"type":"tick","exerciseId":id,"day":days_ago(1)},
            {"type":"tick","exerciseId":other,"day":days_ago(1)},
        ]))
        .await;
    assert_eq!(active_days(&st), vec![days_ago(1).to_string()]);
}

#[sqlx::test]
async fn a_failed_op_rolls_back_the_whole_batch(db: PgPool) {
    let api = Api::new(db).await;
    let id = api.cycle_exercise("Back").await;

    let (s, _) = api
        .call(
            "POST",
            "/api/sync",
            Some(json!({"ops":[
                {"type":"tick","exerciseId":id,"day":today()},
                {"type":"tick","exerciseId":id,"day":today() + Duration::days(3)},
            ]})),
        )
        .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);

    let st = api.state().await;
    assert!(
        active_days(&st).is_empty(),
        "the good half of a failed batch was committed"
    );
}

// ---------------------------------------------------------------------------
// Retention -- the two-tier promise
// ---------------------------------------------------------------------------

#[sqlx::test]
async fn prune_drops_old_detail_but_never_the_day_itself(db: PgPool) {
    let api = Api::new(db.clone()).await;
    let id = api.cycle_exercise("Back").await;
    let other = api.cycle_exercise("Chest").await;

    api.sync(json!([
        {"type":"tick","exerciseId":id,"day":days_ago(30)},
        {"type":"tick","exerciseId":other,"day":days_ago(30)},
        {"type":"tick","exerciseId":id,"day":today()},
        {"type":"tick","exerciseId":other,"day":today()},
    ]))
    .await;

    let removed = exse::retention::prune(&db, 21).await.unwrap();
    assert_eq!(removed, 2, "the 30-day-old log rows were not pruned");

    let st = api.state().await;
    assert_eq!(st["logs"].as_array().unwrap().len(), 2);
    assert_eq!(
        active_days(&st),
        vec![days_ago(30).to_string(), today().to_string()],
        "pruning detail destroyed the permanent record"
    );

    // Cycle progress lives on the exercise row, so it must survive the prune
    // even though the log that created it is gone.
    let ex = st["exercises"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == id.as_str())
        .unwrap()
        .clone();
    assert_eq!(
        ex["completedOn"],
        days_ago(30).to_string(),
        "pruning wiped cycle progress"
    );
}

// ---------------------------------------------------------------------------
// Exercise management
// ---------------------------------------------------------------------------

#[sqlx::test]
async fn upsert_creates_then_updates_by_client_id(db: PgPool) {
    let api = Api::new(db).await;
    let id = uuid::Uuid::new_v4().to_string();

    api.sync(json!([{
        "type":"upsertExercise","id":id,"name":"Wall sit",
        "category":"Legs","cadence":"cycle","sortOrder":99
    }]))
    .await;

    let st = api.state().await;
    let found = st["exercises"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == id.as_str())
        .cloned()
        .expect("exercise was not created");
    assert_eq!(found["name"], "Wall sit");

    api.sync(json!([{
        "type":"upsertExercise","id":id,"name":"Wall sit (long)",
        "category":"Legs","cadence":"daily","sortOrder":99
    }]))
    .await;

    let st = api.state().await;
    let found = st["exercises"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == id.as_str())
        .cloned()
        .unwrap();
    assert_eq!(found["name"], "Wall sit (long)");
    assert_eq!(found["cadence"], "daily");
    assert_eq!(st["exercises"].as_array().unwrap().len(), seeded() + 1);
}

#[sqlx::test]
async fn reorder_assigns_sort_order_by_position(db: PgPool) {
    let api = Api::new(db).await;
    let st = api.state().await;
    let ids: Vec<Value> = st["exercises"]
        .as_array()
        .unwrap()
        .iter()
        .rev()
        .map(|e| e["id"].clone())
        .collect();

    let st = api.sync(json!([{"type":"reorder","ids":ids}])).await;
    let orders: Vec<i64> = st["exercises"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["sortOrder"].as_i64().unwrap())
        .collect();

    assert_eq!(orders, (0..seeded() as i64).collect::<Vec<i64>>());
}

// ---------------------------------------------------------------------------
// Account recovery
// ---------------------------------------------------------------------------

#[sqlx::test]
async fn resetting_a_password_keeps_every_trace_of_the_account(db: PgPool) {
    let api = Api::new(db.clone()).await;
    let a = api.cycle_exercise("Back").await;
    let b = api.cycle_exercise("Chest").await;

    api.sync(json!([
        {"type":"tick","exerciseId":a,"day":days_ago(1)},
        {"type":"tick","exerciseId":b,"day":days_ago(1)},
    ]))
    .await;
    let before = api.state().await;
    assert_eq!(active_days(&before), vec![days_ago(1).to_string()]);

    auth::set_password(&db, "admin", "a whole new password")
        .await
        .unwrap();

    // The old session is gone -- a reset must not leave a signed-in phone.
    let (s, _) = api.call("GET", "/api/state", None).await;
    assert_eq!(s, StatusCode::UNAUTHORIZED, "the reset left a live session");

    let res = api
        .router
        .clone()
        .oneshot(
            Request::post("/api/login")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({"username":"admin","password":"a whole new password"}).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK, "the new password does not work");

    // And nothing about the account moved. This is the whole point: the only
    // recovery route used to be deleting the user, which cascaded through
    // exercises, logs and the permanent active_days record.
    let days: i64 = sqlx::query_scalar("select count(*) from active_days")
        .fetch_one(&db)
        .await
        .unwrap();
    let logs: i64 = sqlx::query_scalar("select count(*) from exercise_logs")
        .fetch_one(&db)
        .await
        .unwrap();
    let exercises: i64 = sqlx::query_scalar("select count(*) from exercises")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(days, 1, "recovery destroyed the permanent day record");
    assert_eq!(logs, 2, "recovery destroyed the history");
    assert_eq!(exercises, seeded() as i64, "recovery destroyed the exercises");
}

#[sqlx::test]
async fn a_password_reset_refuses_an_unknown_user_and_a_short_password(db: PgPool) {
    Api::new(db.clone()).await;

    assert!(auth::set_password(&db, "nobody", "long enough").await.is_err());
    assert!(auth::set_password(&db, "admin", "short").await.is_err());
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

#[sqlx::test]
async fn seeding_merges_by_name_instead_of_duplicating(db: PgPool) {
    let api = Api::new(db.clone()).await;

    // Re-applying the catalogue must be a no-op on the exercise count: a name
    // that already exists has its group and cadence updated in place, never a
    // second row created.
    let mut tx = db.begin().await.unwrap();
    let added = seed::apply_for(&mut tx, api.user_id(&db).await).await.unwrap();
    tx.commit().await.unwrap();
    assert_eq!(added, 0, "re-seeding duplicated the catalogue");

    let st = api.state().await;
    assert_eq!(st["exercises"].as_array().unwrap().len(), seeded());

    // The daily band is the Common group plus crunches and the plank.
    let daily: Vec<&str> = st["exercises"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["cadence"] == "daily")
        .map(|e| e["name"].as_str().unwrap())
        .collect();
    for name in ["Pull up", "Dips", "Squats", "Push up", "Crunches", "Plank"] {
        assert!(daily.contains(&name), "{name} is missing from the daily band");
    }
}
