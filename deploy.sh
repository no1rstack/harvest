#!/usr/bin/env bash
# Harvest deploy wrapper — Infisical → env → podman-compose
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export INFISICAL_PROJECT_ID="${INFISICAL_PROJECT_ID:-5b45a8a0-eb6d-4791-8dd3-705978da44d0}"
export COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/compose.vps.yml}"
export COMPOSE_PROJECT="${COMPOSE_PROJECT:-harvest}"
export REQUIRED_VARS="HARVEST_DATABASE_URL"
exec /home/hira/scripts/deploy.sh "$@"
