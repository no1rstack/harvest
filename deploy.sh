#!/usr/bin/env bash
# Harvest deploy wrapper — Infisical → env → podman-compose
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/compose.vps.yml}"
export COMPOSE_PROJECT="${COMPOSE_PROJECT:-harvest}"
export COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-$ROOT/.env.vps}"
export REQUIRED_VARS="HARVEST_DATABASE_URL KEYCLOAK_CLIENT_ID KEYCLOAK_CLIENT_SECRET COLLECTION_INTERNAL_TOKEN CASCADES_API_URL KEYCLOAK_REALM HARVEST_AUTH_REQUIRED HARVEST_COOKIE_SECURE"
exec /home/hira/scripts/deploy.sh "$@"
