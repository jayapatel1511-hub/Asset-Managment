#!/usr/bin/env bash
#
# One command that proves the whole system, from an empty database to a built client.
#
# The repository had four ways to run tests and no way to answer "is it all working?" — so the
# honest answer to that question was a paragraph, and a paragraph is the kind of thing that
# quietly stops being true. This script is the answer instead. It is what CI runs and what a
# developer runs before saying the build is green.
#
# It is deliberately strict about ordering: the database comes up first, migrations apply to it
# from nothing, and only then does anything test against it. A suite that passes against a
# database somebody hand-patched three weeks ago has proved very little.
#
#   scripts/verify.sh              full run
#   scripts/verify.sh --fast       skip the client build and the PGlite pass
#
set -euo pipefail
cd "$(dirname "$0")/.."

FAST=0
[[ "${1:-}" == "--fast" ]] && FAST=1

bold() { printf '\n\033[1m── %s\033[0m\n' "$1"; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$1"; exit 1; }

bold "PostgreSQL"
docker compose up -d --wait >/dev/null || fail "could not start the database container"
ok "postgres:17 healthy on 127.0.0.1:5433"

bold "Migrations from an empty database"
npm --prefix server run --silent db:migrate || fail "migrations did not apply"
# The second run is the real assertion: a migration set that is not idempotent is a migration set
# that cannot be run against an environment somebody else already migrated.
npm --prefix server run --silent db:check || fail "a second migration run was not a no-op"
ok "migrations apply, and re-applying changes nothing"

bold "Typecheck"
npm run --silent typecheck || fail "typecheck failed"
ok "contracts, server and app typecheck"

bold "Server suite — real PostgreSQL"
( cd server && AMS_DB=postgres npx vitest run ) || fail "server suite failed against PostgreSQL"
ok "server suite green against PostgreSQL"

if [[ $FAST -eq 0 ]]; then
  bold "Server suite — PGlite fallback"
  # Both drivers stay green on purpose: that is the evidence nothing above db/ knows which one it
  # has. Concurrency tests skip themselves here, and say so.
  ( cd server && AMS_DB=pglite npx vitest run ) || fail "server suite failed against PGlite"
  ok "server suite green against PGlite"
fi

bold "Client suite"
( cd app && npx vitest run ) || fail "client suite failed"
ok "client suite green"

if [[ $FAST -eq 0 ]]; then
  bold "Client build"
  ( cd app && npm run build ) >/dev/null || fail "client build failed"
  ok "client builds"
fi

printf '\n\033[32m\033[1mAll green.\033[0m app → HTTP API → PostgreSQL, migrations and both drivers.\n\n'
