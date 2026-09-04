use crate::auth::{self, AuthUser, COOKIE_NAME};
use crate::error::{AppError, AppResult};
use crate::AppState;
use axum::extract::State;
use axum::Json;
use axum_extra::extract::cookie::SignedCookieJar;
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
pub struct LoginBody {
    username: String,
    password: String,
}

pub async fn login(
    State(state): State<AppState>,
    jar: SignedCookieJar,
    Json(body): Json<LoginBody>,
) -> AppResult<(SignedCookieJar, Json<Value>)> {
    let user = sqlx::query!(
        "select id, username, password_hash from users where username = $1",
        body.username
    )
    .fetch_optional(&state.db)
    .await?;

    // Same message and comparable work either way, so a wrong username and a
    // wrong password are indistinguishable from the outside. Hashing costs
    // about what verifying does, and unlike a hardcoded dummy hash it cannot
    // silently stop working by failing to parse.
    let Some(user) = user else {
        let _ = auth::hash_password(&body.password);
        return Err(AppError::BadRequest(
            "Wrong username or password.".to_string(),
        ));
    };

    if !auth::verify_password(&body.password, &user.password_hash) {
        return Err(AppError::BadRequest(
            "Wrong username or password.".to_string(),
        ));
    }

    let cookie = auth::issue_session(&state.db, user.id, state.cookie_secure).await?;
    Ok((
        jar.add(cookie),
        Json(json!({ "username": user.username })),
    ))
}

pub async fn logout(
    State(state): State<AppState>,
    jar: SignedCookieJar,
) -> AppResult<SignedCookieJar> {
    if let Some(c) = jar.get(COOKIE_NAME) {
        auth::revoke_session(&state.db, c.value()).await?;
    }
    Ok(jar.remove(COOKIE_NAME))
}

pub async fn me(user: AuthUser) -> Json<Value> {
    Json(json!({ "username": user.username }))
}

#[derive(Deserialize)]
pub struct PasswordBody {
    current: String,
    next: String,
}

pub async fn change_password(
    State(state): State<AppState>,
    jar: SignedCookieJar,
    user: AuthUser,
    Json(body): Json<PasswordBody>,
) -> AppResult<(SignedCookieJar, Json<Value>)> {
    if body.next.len() < 8 {
        return Err(AppError::BadRequest(
            "Use at least 8 characters.".to_string(),
        ));
    }

    let hash = sqlx::query_scalar!("select password_hash from users where id = $1", user.id)
        .fetch_one(&state.db)
        .await?;

    if !auth::verify_password(&body.current, &hash) {
        return Err(AppError::BadRequest("That's not your current password.".to_string()));
    }

    let next = auth::hash_password(&body.next).map_err(AppError::Other)?;
    sqlx::query!(
        "update users set password_hash = $1 where id = $2",
        next,
        user.id
    )
    .execute(&state.db)
    .await?;

    // Changing a password signs out every session, including this one, then
    // immediately reissues one here so the phone in your hand stays logged in.
    sqlx::query!("delete from sessions where user_id = $1", user.id)
        .execute(&state.db)
        .await?;

    let cookie = auth::issue_session(&state.db, user.id, state.cookie_secure).await?;
    Ok((jar.add(cookie), Json(json!({ "ok": true }))))
}
