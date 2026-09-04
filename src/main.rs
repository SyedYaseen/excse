mod error;

use anyhow::Context;
use axum::Router;
use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::net::SocketAddr;
use std::sync::Arc;
use tower_http::compression::CompressionLayer;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;
use tracing_subscriber::EnvFilter;

pub struct Config {
    pub port: u16,
    pub static_dir: String,
    pub database_url: String,
    pub retention_days: i32,
}

impl Config {
    fn from_env() -> anyhow::Result<Self> {
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
        })
    }
}

pub struct AppState {
    pub db: PgPool,
    pub retention_days: i32,
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

    let state = Arc::new(AppState {
        db,
        retention_days: config.retention_days,
    });

    // The SPA is served last, with index.html as the fallback so client-side
    // views resolve on a hard refresh. API routes are layered on ahead of it.
    let spa = ServeDir::new(&config.static_dir)
        .fallback(ServeFile::new(format!("{}/index.html", config.static_dir)));

    let app = Router::new()
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
