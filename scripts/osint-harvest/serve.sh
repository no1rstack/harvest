#!/usr/bin/env bash
# Serve Harvest Collection Platform on :3020 (harvest.noirstack.com)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

if [[ -f "$ROOT/.env.harvest.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env.harvest.local"
  set +a
fi

export PRODUCT_NAME=Harvest
export PORT="${PORT:-3020}"
export HOST="${HOST:-127.0.0.1}"
export BIND_HOST="${BIND_HOST:-$HOST}"
export HARVEST_PG_HOST_REWRITE="${HARVEST_PG_HOST_REWRITE:-0}"
export HARVEST_COOKIE_SECURE="${HARVEST_COOKIE_SECURE:-1}"
export HARVEST_AUTH_REQUIRED="${HARVEST_AUTH_REQUIRED:-1}"
export HARVEST_DATABASE_URL="${HARVEST_DATABASE_URL:-${DATABASE_URL:-}}"
export DATABASE_URL="${HARVEST_DATABASE_URL}"

if [[ -z "${HARVEST_DATABASE_URL:-}" ]]; then
  echo "ERROR: HARVEST_DATABASE_URL required (npm run osint:db:sync -- harvest)" >&2
  exit 1
fi

echo "[harvest-serve] PORT=$PORT BIND=$BIND_HOST AUTH=${HARVEST_AUTH_REQUIRED}"
exec npx tsx server.ts
