#!/usr/bin/env bash
# Populate the dedicated Harvest Infisical project from authoritative sources.
# Does NOT read Judicium-only secrets into Harvest — only Harvest-owned keys.
#
# Prerequisites:
#   1. Machine identity `migration-cli` added to Harvest project with Admin role
#      Project: f7f058b6-d267-45c1-9311-e0962a74e923 @ crypt.noirstack.com
#   2. INFISICAL_TOKEN in environment (see /home/hira/scripts/.infisical-token)
#
# Usage:
#   ./scripts/infisical/bootstrap-harvest-secrets.sh
#   ./scripts/infisical/bootstrap-harvest-secrets.sh --dry-run
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

HARVEST_PROJECT_ID="${HARVEST_INFISICAL_PROJECT_ID:-f7f058b6-d267-45c1-9311-e0962a74e923}"
JUDICIUM_PROJECT_ID="${JUDICIUM_INFISICAL_PROJECT_ID:-5b45a8a0-eb6d-4791-8dd3-705978da44d0}"
KEYCLOAK_PROJECT_ID="${KEYCLOAK_INFISICAL_PROJECT_ID:-75ddc797-61e4-48c1-9d99-d307f83782ab}"
INFISICAL_DOMAIN="${INFISICAL_DOMAIN:-https://crypt.noirstack.com}"
INFISICAL_ENV="${INFISICAL_ENV:-prod}"
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --help|-h)
      sed -n '2,12p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
  esac
done

if [[ -z "${INFISICAL_TOKEN:-}" && -f /home/hira/scripts/.infisical-token ]]; then
  # shellcheck disable=SC1091
  source /home/hira/scripts/.infisical-token
fi
export PATH="${HOME}/.local/bin:${PATH}"

pick() {
  local key="$1"
  shift
  for blob in "$@"; do
    local line val
    line="$(grep -E "^${key}=" <<<"$blob" | tail -1 || true)"
    [[ -n "$line" ]] || continue
    val="${line#*=}"
    val="${val%\'}"; val="${val#\'}"
    val="${val%\"}"; val="${val#\"}"
    if [[ -n "$val" ]]; then
      printf '%s' "$val"
      return 0
    fi
  done
  return 1
}

echo "=== Harvest Infisical bootstrap ==="
echo "target project: $HARVEST_PROJECT_ID ($INFISICAL_ENV)"

JUD="$(infisical export --projectId="$JUDICIUM_PROJECT_ID" --env="$INFISICAL_ENV" --domain="$INFISICAL_DOMAIN" --format=dotenv 2>/dev/null || true)"
KC="$(infisical export --projectId="$KEYCLOAK_PROJECT_ID" --env="$INFISICAL_ENV" --domain="$INFISICAL_DOMAIN" --format=dotenv 2>/dev/null || true)"

LOCAL_HARVEST=""
[[ -f "$ROOT/.env.harvest.local" ]] && LOCAL_HARVEST="$(cat "$ROOT/.env.harvest.local")"
LOCAL_JUD=""
[[ -f "$ROOT/../judicium/.env.vps" ]] && LOCAL_JUD="$(cat "$ROOT/../judicium/.env.vps")"
LOCAL_CASCADES=""
[[ -f "$ROOT/../cascades/deploy/vps/.env.vps" ]] && LOCAL_CASCADES="$(cat "$ROOT/../cascades/deploy/vps/.env.vps")"
HARVEST_DB="$(pick HARVEST_DATABASE_URL "$JUD" "$LOCAL_HARVEST" "$LOCAL_JUD" || true)"
HARVEST_DB="${HARVEST_DB//@127.0.0.1:5499/@postgres-main:5432}"
HARVEST_DB="${HARVEST_DB//@127.0.0.1:5432/@postgres-main:5432}"
KC_CLIENT_ID="$(pick HARVEST_KEYCLOAK_CLIENT_ID "$KC" "$LOCAL_HARVEST" || pick KEYCLOAK_CLIENT_ID "$LOCAL_HARVEST" || true)"
KC_CLIENT_SECRET="$(pick HARVEST_KEYCLOAK_CLIENT_SECRET "$KC" "$LOCAL_HARVEST" || pick KEYCLOAK_CLIENT_SECRET "$LOCAL_HARVEST" || true)"
KC_REDIRECT="$(pick HARVEST_KEYCLOAK_REDIRECT_URI "$KC" "$LOCAL_HARVEST" || pick KEYCLOAK_REDIRECT_URI "$LOCAL_HARVEST" || true)"
KC_HOME="$(pick HARVEST_KEYCLOAK_HOME_URL "$KC" "$LOCAL_HARVEST" || pick KEYCLOAK_HOME_URL "$LOCAL_HARVEST" || true)"
KC_BASE="$(pick KEYCLOAK_BASE_URL "$KC" "$LOCAL_HARVEST" || true)"
COL_TOKEN="$(pick COLLECTION_INTERNAL_TOKEN "$LOCAL_HARVEST" "$LOCAL_JUD" "$LOCAL_CASCADES" || true)"
CASCADES_PUBLIC="$(pick CASCADES_PUBLIC_URL "$LOCAL_CASCADES" "$LOCAL_JUD" || true)"
GHCR_USER="$(pick GHCR_USERNAME "$JUD" || echo 'no1rstack')"
GHCR_PASS="$(pick GHCR_PASSWORD "$JUD" || true)"

missing=()
[[ -n "$HARVEST_DB" ]] || missing+=("HARVEST_DATABASE_URL")
[[ -n "$KC_CLIENT_ID" ]] || missing+=("KEYCLOAK_CLIENT_ID")
[[ -n "$KC_CLIENT_SECRET" ]] || missing+=("KEYCLOAK_CLIENT_SECRET")
[[ -n "$COL_TOKEN" ]] || missing+=("COLLECTION_INTERNAL_TOKEN")
if ((${#missing[@]})); then
  echo "ERROR: missing required source values: ${missing[*]}" >&2
  exit 1
fi

TMP="$(mktemp /tmp/harvest-infisical-XXXXXX.env)"
trap 'rm -f "$TMP"' EXIT

cat >"$TMP" <<EOF
# Harvest — dedicated Infisical project (generated $(date -u +%Y-%m-%dT%H:%M:%SZ))
HARVEST_DATABASE_URL=$HARVEST_DB
HARVEST_PG_HOST_REWRITE=0

KEYCLOAK_BASE_URL=${KC_BASE:-https://auth.noirstack.com}
KEYCLOAK_REALM=gateway
KEYCLOAK_CLIENT_ID=$KC_CLIENT_ID
KEYCLOAK_CLIENT_SECRET=$KC_CLIENT_SECRET
KEYCLOAK_REDIRECT_URI=${KC_REDIRECT:-https://harvest.noirstack.com/api/harvest/auth/callback}
KEYCLOAK_HOME_URL=${KC_HOME:-https://harvest.noirstack.com}
HARVEST_AUTH_REQUIRED=1
HARVEST_COOKIE_SECURE=1

HARVEST_PUBLIC_URL=https://harvest.noirstack.com
JUDICIUM_PUBLIC_URL=https://judicium.app
CASCADES_API_URL=http://cascades:3000
CASCADES_PUBLIC_URL=${CASCADES_PUBLIC:-https://cascades.work}
COLLECTION_API_URL=http://harvest:3000
COLLECTION_INTERNAL_TOKEN=$COL_TOKEN

HARVEST_SCHEDULER_ENABLED=1
HARVEST_CASCADES_DUE_ENABLED=1
HARVEST_CASCADES_DUE_INTERVAL_MINUTES=60
HARVEST_CASCADES_DUE_LIMIT=100
HARVEST_DAILY_PULL_ENABLED=1
HARVEST_DAILY_PULL_MODE=cascades-due
HARVEST_DAILY_PULL_INTERVAL_HOURS=24
HARVEST_DAILY_PULL_DRY_RUN=0

HARVEST_FEEDS_ENABLED=1
HARVEST_FEEDS_DELEGATE_JUDICIUM=1
HARVEST_FEEDS_LAYERS_INTERVAL_MINUTES=30
HARVEST_FEEDS_RSS_INTERVAL_MINUTES=15
HARVEST_FEEDS_DAILY_INTERVAL_HOURS=24
HARVEST_FEEDS_STARTUP_DELAY_SECONDS=20
HARVEST_PLATFORM_CONFIG_DIR=/app/data
JUDICIUM_USE_HARVEST_INTELLIGENCE=1
HARVEST_INTELLIGENCE_URL=https://harvest.noirstack.com
HARVEST_REQUIRED_ROLES=harvest.noirstack.com

GHCR_USERNAME=$GHCR_USER
GHCR_PASSWORD=$GHCR_PASS

# OSINT keys — synced from Judicium (run judicium/scripts/sync-osint-secrets.sh)
JUDICIUM_PUBLIC_URL=$(pick JUDICIUM_PUBLIC_URL "$JUD" "$LOCAL_JUD" || echo 'https://judicium.app')
JUDICIUM_INTERNAL_URL=$(pick JUDICIUM_INTERNAL_URL "$JUD" "$LOCAL_JUD" || echo 'http://judicium:3002')
OPENSANCTIONS_API_KEY=$(pick OPENSANCTIONS_API_KEY "$JUD" "$LOCAL_JUD" || true)
GOVINFO_API_KEY=$(pick GOVINFO_API_KEY "$JUD" "$LOCAL_JUD" || true)
CAP_API_KEY=$(pick CAP_API_KEY "$JUD" "$LOCAL_JUD" || true)
COURTLISTENER_API_TOKEN=$(pick COURTLISTENER_API_TOKEN "$JUD" "$LOCAL_JUD" || true)
COURTLISTENER_BASE_URL=$(pick COURTLISTENER_BASE_URL "$JUD" "$LOCAL_JUD" || true)
OPENSTATES_API_KEY=$(pick OPENSTATES_API_KEY "$JUD" "$LOCAL_JUD" || true)
CONGRESS_API_KEY=$(pick CONGRESS_API_KEY "$JUD" "$LOCAL_JUD" || true)
REGULATIONS_API_KEY=$(pick REGULATIONS_API_KEY "$JUD" "$LOCAL_JUD" || true)
YENTE_URL=$(pick YENTE_URL "$JUD" "$LOCAL_JUD" || true)
EOF

echo "--- secrets to upsert ($(grep -c '^[A-Z]' "$TMP" || echo 0) keys) ---"
grep -E '^[A-Z_]+=' "$TMP" | sed 's/=.*$/=***redacted***/'

if [[ "$DRY_RUN" == "1" ]]; then
  echo "dry-run: not writing to Infisical"
  exit 0
fi

infisical secrets set --file="$TMP" \
  --projectId="$HARVEST_PROJECT_ID" \
  --env="$INFISICAL_ENV" \
  --domain="$INFISICAL_DOMAIN"

echo "=== done — verify ==="
infisical export --projectId="$HARVEST_PROJECT_ID" --env="$INFISICAL_ENV" --domain="$INFISICAL_DOMAIN" --format=dotenv \
  | grep -E '^[A-Z_]+=' | sed 's/=.*$/=***/' | sort
