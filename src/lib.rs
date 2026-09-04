pub mod auth;
pub mod error;
pub mod models;
pub mod retention;
pub mod routes;

use axum::extract::FromRef;
use axum::Router;
use axum_extra::extract::cookie::Key;
use sqlx::PgPool;
use tower_http::compression::CompressionLayer;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;

/// Cheap to clone: PgPool is Arc-backed internally and Key is a small byte
/// array, so this is passed by value the way axum expects rather than being
/// wrapped in another Arc.
#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub retention_days: i32,
    pub cookie_secure: bool,
    pub cookie_key: Key,
}

impl FromRef<AppState> for Key {
    fn from_ref(state: &AppState) -> Self {
        state.cookie_key.clone()
    }
}

/// API only. Used directly by the integration tests, which have no build
/// output to serve.
pub fn api_router(state: AppState) -> Router {
    Router::new()
        .nest("/api", routes::api())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

/// The full app: API routes matched ahead of the SPA, which falls back to
/// index.html so client-side views resolve on a hard refresh.
pub fn build_router(state: AppState, static_dir: &str) -> Router {
    let spa = ServeDir::new(static_dir).fallback(ServeFile::new(format!("{static_dir}/index.html")));

    Router::new()
        .nest("/api", routes::api())
        .fallback_service(spa)
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
