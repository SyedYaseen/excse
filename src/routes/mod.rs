pub mod auth;
pub mod state;

use crate::AppState;
use axum::routing::{get, post};
use axum::Router;

pub fn api() -> Router<AppState> {
    Router::new()
        .route("/login", post(auth::login))
        .route("/signup", post(auth::signup))
        .route("/logout", post(auth::logout))
        .route("/me", get(auth::me))
        .route("/password", post(auth::change_password))
        .route("/state", get(state::get_state))
        .route("/sync", post(state::sync))
        // TEMP: remove with the Settings reset button once asked.
        .route("/reset-progress", post(state::reset_progress))
}
