# The runtime image ships zero JavaScript dependencies. Node exists only in
# stage 1 to run `vite build`; what ships is a Rust binary plus static files.
# An npm advisory therefore affects a build you re-run, not a running service.

# --- 1. Frontend -------------------------------------------------------------
FROM node:24-alpine AS web

WORKDIR /build
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci

COPY web ./web
RUN cd web && npm run build
# -> /build/dist

# --- 2. Cargo chef planner ---------------------------------------------------
FROM rust:1.94-slim AS planner

WORKDIR /app
RUN cargo install cargo-chef --locked
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY migrations ./migrations
COPY .sqlx ./.sqlx
RUN cargo chef prepare --recipe-path recipe.json

# --- 3. Builder --------------------------------------------------------------
FROM rust:1.94-slim AS builder

WORKDIR /app
RUN cargo install cargo-chef --locked

COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json

COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY migrations ./migrations
COPY .sqlx ./.sqlx
# Queries are checked against the committed .sqlx data, so the build needs no
# database. Re-run `cargo sqlx prepare` and commit .sqlx after changing a query.
ENV SQLX_OFFLINE=true
RUN cargo build --release --bin exse

# --- 4. Runtime --------------------------------------------------------------
FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN groupadd -r app && useradd -r -g app app

COPY --from=builder /app/target/release/exse /app/exse
COPY --from=web /build/dist /app/dist

USER app
EXPOSE 3005
CMD ["/app/exse"]
