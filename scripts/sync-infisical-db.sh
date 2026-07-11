#!/usr/bin/env bash
# Export Judicium / H3XA / shared Harvest DB URLs from Infisical → local env overlays.
# Domain: https://crypt.noirstack.com
#
# Usage:
#   ./scripts/sync-infisical-db.sh              # harvest + both products
#   ./scripts/sync-infisical-db.sh harvest      # shared harvest only → .env.harvest.local
#   ./scripts/sync-infisical-db.sh judicium
#   ./scripts/sync-infisical-db.sh h3xa
#
# DB naming convention:
#   judicium → user judicium_user / db judicium
#   h3xa     → user h3xa_user     / db h3xa
#   harvest  → user harvest_user  / db harvest  (HARVEST_DATABASE_URL)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JUDICIUM_PROJECT_ID="${JUDICIUM_PROJECT_ID:-5b45a8a0-eb6d-4791-8dd3-705978da44d0}"
H3XA_PROJECT_ID="${H3XA_PROJECT_ID:-d88b5ad3-da33-4c65-9598-500abdcba50f}"
INFISICAL_DOMAIN="${INFISICAL_DOMAIN:-https://crypt.noirstack.com}"
INFISICAL_ENV="${INFISICAL_ENV:-prod}"
PRODUCT="${1:-all}"

if [[ -z "${INFISICAL_TOKEN:-}" && -f /home/hira/scripts/.infisical-token ]]; then
  # shellcheck disable=SC1091
  source /home/hira/scripts/.infisical-token
fi
if [[ -z "${INFISICAL_TOKEN:-}" ]]; then
  echo "ERROR: INFISICAL_TOKEN required (export or /home/hira/scripts/.infisical-token)" >&2
  exit 1
fi

hostify_url() {
  node -e "
    const u = new URL(process.argv[1]);
    if (u.hostname === 'postgres-main') {
      u.hostname = '127.0.0.1';
      u.port = '5499';
    }
    process.stdout.write(u.toString());
  " "$1"
}

describe_url() {
  node -e "
    const u = new URL(process.argv[1]);
    console.log(process.argv[2] + ': user=' + u.username + ' host=' + u.hostname + ':' + (u.port||'5432') + ' db=' + u.pathname.slice(1));
  " "$1" "$2"
}

upsert_env_key() {
  local file="$1" key="$2" value="$3"
  mkdir -p "$(dirname "$file")"
  touch "$file"
  if grep -qE "^${key}=" "$file" 2>/dev/null; then
    local tmp
    tmp="$(mktemp)"
    awk -v k="$key" -v v="$value" '
      BEGIN { done=0 }
      index($0, k "=") == 1 && !done { print k "=" v; done=1; next }
      { print }
      END { if (!done) print k "=" v }
    ' "$file" > "$tmp"
    mv "$tmp" "$file"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$file"
  fi
}

sync_secret() {
  local product="$1" project_id="$2" secret_key="$3" out_file="$4" expect_user="$5" expect_db="$6" env_key="$7"
  echo "→ Infisical $product ($secret_key @ $INFISICAL_ENV)"
  local url host_url
  url="$(infisical secrets get "$secret_key" \
    --projectId="$project_id" \
    --env="$INFISICAL_ENV" \
    --domain="$INFISICAL_DOMAIN" \
    --token="$INFISICAL_TOKEN" \
    --plain)"
  if [[ -z "$url" ]]; then
    echo "ERROR: $secret_key missing in Infisical project $project_id" >&2
    exit 1
  fi
  describe_url "$url" "  crypt"
  host_url="$(hostify_url "$url")"
  describe_url "$host_url" "  local"

  local user db
  user="$(node -e "process.stdout.write(new URL(process.argv[1]).username)" "$url")"
  db="$(node -e "process.stdout.write(new URL(process.argv[1]).pathname.slice(1))" "$url")"
  if [[ "$user" != "$expect_user" || "$db" != "$expect_db" ]]; then
    echo "ERROR: expected user=$expect_user db=$expect_db, got user=$user db=$db" >&2
    exit 1
  fi

  if [[ ! -f "$out_file" ]]; then
    {
      echo "# Generated from Infisical ($INFISICAL_DOMAIN) project $project_id ($INFISICAL_ENV)"
      echo "# Product: $product — user $expect_user / db $expect_db"
    } > "$out_file"
  fi
  upsert_env_key "$out_file" "$env_key" "$host_url"
  # Harvest overlay also sets DATABASE_URL so CLI resolveDatabaseUrl works
  if [[ "$product" == "harvest" ]]; then
    upsert_env_key "$out_file" "DATABASE_URL" "$host_url"
  fi
  upsert_env_key "$out_file" "H3XA_PG_HOST_REWRITE" "0"
  chmod 600 "$out_file" 2>/dev/null || true
  echo "  wrote $env_key → $out_file"
}

case "$PRODUCT" in
  judicium)
    sync_secret judicium "$JUDICIUM_PROJECT_ID" DATABASE_URL "$ROOT/.env.local" judicium_user judicium DATABASE_URL
    ;;
  h3xa)
    sync_secret h3xa "$H3XA_PROJECT_ID" DATABASE_URL "$ROOT/.env.h3xa.local" h3xa_user h3xa DATABASE_URL
    ;;
  harvest)
    sync_secret harvest "$JUDICIUM_PROJECT_ID" HARVEST_DATABASE_URL "$ROOT/.env.harvest.local" harvest_user harvest HARVEST_DATABASE_URL
    ;;
  both)
    sync_secret judicium "$JUDICIUM_PROJECT_ID" DATABASE_URL "$ROOT/.env.local" judicium_user judicium DATABASE_URL
    sync_secret h3xa "$H3XA_PROJECT_ID" DATABASE_URL "$ROOT/.env.h3xa.local" h3xa_user h3xa DATABASE_URL
    ;;
  all|"")
    sync_secret harvest "$JUDICIUM_PROJECT_ID" HARVEST_DATABASE_URL "$ROOT/.env.harvest.local" harvest_user harvest HARVEST_DATABASE_URL
    sync_secret judicium "$JUDICIUM_PROJECT_ID" DATABASE_URL "$ROOT/.env.local" judicium_user judicium DATABASE_URL
    sync_secret h3xa "$H3XA_PROJECT_ID" DATABASE_URL "$ROOT/.env.h3xa.local" h3xa_user h3xa DATABASE_URL
    ;;
  *)
    echo "Usage: $0 [harvest|judicium|h3xa|both|all]" >&2
    exit 1
    ;;
esac

echo "Done. Harvest into shared store: npm run osint:harvest -- --target example.com"
