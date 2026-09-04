pub mod auth;

use crate::AppState;
use axum::routing::{get, post};
use axum::Router;

pub fn api() -> Router<AppState> {
    Router::new()
        .route("/login", post(auth::login))
        .route("/logout", post(auth::logout))
        .route("/me", get(auth::me))
        .route("/password", post(auth::change_password))
}
