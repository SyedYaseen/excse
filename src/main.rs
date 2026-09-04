mod auth;
mod error;
mod routes;

use anyhow::{bail, Context};
use axum::extract::FromRef;
use axum::Router;
use axum_extra::extract::cookie::Key;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::net::SocketAddr;
use tower_http::compression::CompressionLayer;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

pub struct Config {
    pub port: u16,
    pub static_dir: String,
    pub database_url: String,
    pub retention_days: i32,
    pub cookie_secret: String,
    pub cookie_secure: bool,
    pub admin_initial_password: Option<String>,
}

impl Config {
    fn from_env() -> anyhow::Result<Self> {
        let cookie_secret = std::env::var("COOKIE_SECRET")
            .context("COOKIE_SECRET is required (openssl rand -hex 64)")?;
        // A short key would silently weaken cookie signing, and generating one
        // at boot would sign the phone out on every restart. Fail loudly.
        if cookie_secret.len() < 64 {
            bail!("COOKIE_SECRET must be at least 64 characters (openssl rand -hex 64)");
        }

        Ok(Self {
            port: std::env::var("PORT")
                .unwrap_or_else(|_| "3005".into())
                .parse()
                .context("PORT must be a number")?,
            static_dir: std::env::var("STATIC_DIR").unwrap_or_else(|_| "dist".into()),
            database_url: std::env::var("DATABASE_URL").context("DATABASE_URL is required")?,
            retention_days: std::env::var("RETENTION_DAYS")
                .unwrap_or_else(|_| "21".into())
                .parse()
                .context("RETENTION_DAYS must be a number")?,
            cookie_secret,
            // Served over plain HTTP on the LAN for now; a Secure cookie would
            // never be sent. Flip this on once HTTPS lands (docs/TODO.md).
            cookie_secure: std::env::var("COOKIE_SECURE")
                .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
                .unwrap_or(false),
            admin_initial_password: std::env::var("ADMIN_INITIAL_PASSWORD")
                .ok()
                .filter(|s| !s.is_empty()),
        })
    }
}

/// Cheap to clone: PgPool is Arc-backed internally and Key is a small byte
/// array, so this is passed by value the way axum expects rather than wrapped
/// in another Arc.
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

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let config = Config::from_env()?;

    let db = PgPoolOptions::new()
        .max_connections(5)
        .connect(&config.database_url)
        .await
        .context("could not connect to the database")?;

    sqlx::migrate!("./migrations")
        .run(&db)
        .await
        .context("migrations failed")?;
    tracing::info!("migrations up to date");

    auth::bootstrap(&db, config.admin_initial_password.as_deref()).await?;

    let state = AppState {
        db,
        retention_days: config.retention_days,
        cookie_secure: config.cookie_secure,
        cookie_key: Key::from(config.cookie_secret.as_bytes()),
    };

    // The SPA is served last, with index.html as the fallback so client-side
    // views resolve on a hard refresh. API routes are matched ahead of it.
    let spa = ServeDir::new(&config.static_dir)
        .fallback(ServeFile::new(format!("{}/index.html", config.static_dir)));

    let app = Router::new()
        .nest("/api", routes::api())
        .fallback_service(spa)
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], config.port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .with_context(|| format!("failed to bind {addr}"))?;

    tracing::info!("exse listening on {addr}, serving {}", config.static_dir);

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("shutting down");
}
