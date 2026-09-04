use crate::error::{AppError, AppResult};
use crate::AppState;
use argon2::password_hash::rand_core::{OsRng, RngCore};
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use axum::extract::{FromRef, FromRequestParts};
use axum::http::request::Parts;
use axum_extra::extract::cookie::{Cookie, Key, SameSite, SignedCookieJar};
use chrono::{Duration, Utc};
use sqlx::PgPool;
use uuid::Uuid;

pub const COOKIE_NAME: &str = "exse_session";
const SESSION_DAYS: i64 = 90;

pub fn hash_password(password: &str) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| anyhow::anyhow!("hashing failed: {e}"))
}

pub fn verify_password(password: &str, hash: &str) -> bool {
    match PasswordHash::new(hash) {
        Ok(parsed) => Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .is_ok(),
        Err(_) => false,
    }
}

fn random_token() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Issues a session row and the cookie that carries its token. The token is
/// stored server-side so logout and revocation actually work.
pub async fn issue_session(db: &PgPool, user_id: Uuid, secure: bool) -> AppResult<Cookie<'static>> {
    let token = random_token();
    let expires_at = Utc::now() + Duration::days(SESSION_DAYS);

    sqlx::query!(
        "insert into sessions (token, user_id, expires_at) values ($1, $2, $3)",
        token,
        user_id,
        expires_at
    )
    .execute(db)
    .await?;

    Ok(Cookie::build((COOKIE_NAME, token))
        .path("/")
        .http_only(true)
        .secure(secure)
        .same_site(SameSite::Lax)
        .max_age(time::Duration::days(SESSION_DAYS))
        .build())
}

pub async fn revoke_session(db: &PgPool, token: &str) -> AppResult<()> {
    sqlx::query!("delete from sessions where token = $1", token)
        .execute(db)
        .await?;
    Ok(())
}

/// An authenticated user. Any handler that takes this is protected; leaving it
/// out is a compile error at the call site rather than a silent hole.
pub struct AuthUser {
    pub id: Uuid,
    pub username: String,
}

impl<S> FromRequestParts<S> for AuthUser
where
    S: Send + Sync,
    AppState: FromRef<S>,
    Key: FromRef<S>,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let jar = SignedCookieJar::<Key>::from_headers(&parts.headers, Key::from_ref(state));
        let token = jar
            .get(COOKIE_NAME)
            .map(|c| c.value().to_owned())
            .ok_or(AppError::Unauthorized)?;

        let app = AppState::from_ref(state);
        let row = sqlx::query!(
            "select u.id, u.username
               from sessions s
               join users u on u.id = s.user_id
              where s.token = $1 and s.expires_at > now()",
            token
        )
        .fetch_optional(&app.db)
        .await?
        .ok_or(AppError::Unauthorized)?;

        Ok(AuthUser {
            id: row.id,
            username: row.username,
        })
    }
}

/// First-run bootstrap. Exercises carry a user_id foreign key, so they cannot
/// be seeded by a migration that runs before any user exists -- admin, the
/// starter catalogue and cycle 1 are created together in one transaction here.
/// No-ops entirely once any user exists.
pub async fn bootstrap(db: &PgPool, initial_password: Option<&str>) -> anyhow::Result<()> {
    let existing: i64 = sqlx::query_scalar!("select count(*) from users")
        .fetch_one(db)
        .await?
        .unwrap_or(0);
    if existing > 0 {
        return Ok(());
    }

    let Some(password) = initial_password else {
        tracing::warn!(
            "no users exist and ADMIN_INITIAL_PASSWORD is unset -- \
             set it and restart, or insert a user by hand (see README)"
        );
        return Ok(());
    };

    let mut tx = db.begin().await?;

    let hash = hash_password(password)?;
    let user_id: Uuid = sqlx::query_scalar!(
        "insert into users (username, password_hash) values ('admin', $1) returning id",
        hash
    )
    .fetch_one(&mut *tx)
    .await?;

    let added = crate::seed::apply_for(&mut tx, user_id).await?;

    sqlx::query!(
        "insert into cycles (user_id, seq, started_on) values ($1, 1, current_date)",
        user_id
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    tracing::warn!(
        "created user 'admin' from ADMIN_INITIAL_PASSWORD with {added} starter exercises -- \
         change the password in Settings"
    );
    Ok(())
}

/// Out-of-band password reset, driven by `exse reset-password` on the machine
/// that owns the database.
///
/// This exists because the only other way back into a forgotten account was to
/// empty the `users` table and let `bootstrap` run again -- and every data
/// table cascades off `users`, so that took the exercises, the logs and the
/// permanent `active_days` record with it. Recovering access must never cost
/// the year view. This touches one column and nothing else.
///
/// Every session is dropped, so a stolen phone cannot outlive the reset.
pub async fn set_password(db: &PgPool, username: &str, password: &str) -> anyhow::Result<()> {
    if password.chars().count() < 8 {
        anyhow::bail!("password must be at least 8 characters");
    }

    let hash = hash_password(password)?;
    let mut tx = db.begin().await?;

    let user_id: Option<Uuid> = sqlx::query_scalar!(
        "update users set password_hash = $1 where username = $2 returning id",
        hash,
        username
    )
    .fetch_optional(&mut *tx)
    .await?;

    let Some(user_id) = user_id else {
        anyhow::bail!("no user named {username}");
    };

    sqlx::query!("delete from sessions where user_id = $1", user_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(())
}
