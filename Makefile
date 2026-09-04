# exse
#
# Local development and deployment to the home server. `make help` lists
# everything; the two you want day to day are `make dev` and `make deploy`.

SHELL := /bin/bash
.DEFAULT_GOAL := help

# --- configuration ----------------------------------------------------------

SERVER      ?= poochi
SERVER_PATH ?= /home/poochi/projects/exse
APP_URL     ?= http://192.168.1.18:3005
LOCAL_URL   ?= http://127.0.0.1:3005

# Deploy whatever branch you are standing on, so deploying a branch is a
# deliberate act rather than a surprise.
BRANCH ?= $(shell git rev-parse --abbrev-ref HEAD)

# The sqlx macros check queries against a live database unless told otherwise.
# On a fresh checkout there is no schema yet -- the binary creates it on first
# boot -- so a plain `cargo build` fails with a wall of "relation does not
# exist". Building against the committed `.sqlx/` cache is what the Docker
# build does too, so this also keeps local and image builds honest: a query
# added without `make sqlx-prepare` fails here rather than in the deploy.
export SQLX_OFFLINE = true

.PHONY: help dev dev-ui serve web check test e2e screens \
        deploy push remote-pull logs restart ps shell \
        db sqlx-prepare clean

# --- local ------------------------------------------------------------------

dev: web ## Build the UI and run the server on :3005 (the whole app, one command)
	@set -a; . ./.env; set +a; cargo run

dev-ui: ## Hot-reload UI: Vite on :5173 proxying /api to the server on :3005
	@set -a; . ./.env; set +a; cargo run & \
	trap 'kill %1 2>/dev/null' EXIT; \
	npm --prefix web run dev

serve: ## Run the server against the last build, without rebuilding the UI
	@set -a; . ./.env; set +a; cargo run

web: ## Build the UI into ./dist
	npm --prefix web run build

# --- tests ------------------------------------------------------------------

check: ## Everything that does not need a running server
	cargo test
	npm --prefix web test

test: check e2e ## Every suite. Needs the app running -- see `make dev`

e2e: ## Browser tests, both themes. Needs the app running on :3005
	@curl -sf -o /dev/null $(LOCAL_URL) \
	  || { echo "exse is not answering on $(LOCAL_URL) -- start it with 'make dev'"; exit 1; }
	npm --prefix e2e test

screens: ## Write e2e/screens/*.png for visual review
	npm --prefix e2e run screens

# --- deploy -----------------------------------------------------------------

deploy: push remote-pull ## Push this branch, then pull and rebuild it on the server

push:
	@# --porcelain rather than `git diff`, so an uncommitted *new* file is
	@# caught too. That is the case that actually bites: the deploy succeeds
	@# and the server quietly runs without the file you just wrote.
	@test -z "$$(git status --porcelain)" \
	  || { echo "working tree is dirty -- commit before deploying:"; \
	       git status --short; exit 1; }
	git push origin $(BRANCH)

remote-pull:
	@echo "==> deploying $(BRANCH) to $(SERVER):$(SERVER_PATH)"
	@ssh $(SERVER) 'set -euo pipefail; \
	  cd $(SERVER_PATH); \
	  git fetch --prune origin; \
	  git checkout $(BRANCH); \
	  git reset --hard origin/$(BRANCH); \
	  docker compose up -d --build'
	@echo "==> waiting for $(APP_URL)"
	@for i in $$(seq 1 60); do \
	  curl -sf -o /dev/null $(APP_URL) && { echo "==> up: $(APP_URL)"; exit 0; }; \
	  sleep 2; \
	done; \
	echo "==> did not come up; check 'make logs'"; exit 1

logs: ## Tail the server's logs
	ssh -t $(SERVER) 'cd $(SERVER_PATH) && docker compose logs -f --tail=100'

restart: ## Restart the container without rebuilding
	ssh $(SERVER) 'cd $(SERVER_PATH) && docker compose restart'

ps: ## What is running on the server
	ssh $(SERVER) 'cd $(SERVER_PATH) && docker compose ps'

shell: ## Open a shell in $(SERVER_PATH)
	ssh -t $(SERVER) 'cd $(SERVER_PATH) && exec $$SHELL -l'

# --- database ---------------------------------------------------------------

db: ## Create the local exse role and database (needs a Postgres superuser)
	docker exec postgres psql -U root -d postgres \
	  -c "CREATE ROLE exse LOGIN PASSWORD 'exse';" \
	  -c "CREATE DATABASE exse OWNER exse;" \
	  -c "ALTER ROLE exse CREATEDB;"

sqlx-prepare: ## Regenerate .sqlx/ after changing a query. Commit the result
	@set -a; . ./.env; set +a; SQLX_OFFLINE=false cargo sqlx prepare

# --- misc -------------------------------------------------------------------

clean:
	cargo clean
	rm -rf dist e2e/test-results e2e/playwright-report e2e/screens

help:
	@grep -hE '^[a-z0-9-]+:.*##' $(MAKEFILE_LIST) \
	  | sort \
	  | awk -F':.*## ' '{printf "  \033[1m%-14s\033[0m %s\n", $$1, $$2}'
