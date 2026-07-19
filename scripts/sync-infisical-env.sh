#!/usr/bin/env bash
# Export all Harvest secrets from Infisical → .env.harvest.local (local dev overlay).
#
# Project: f7f058b6-d267-45c1-9311-e0962a74e923 @ crypt.noirstack.com / prod
#
# Usage:
#   ./scripts/sync-infisical-env.sh
#   HARVEST_INFISICAL_PROJECT_ID=... INFISICAL_ENV=dev ./scripts/sync-infisical-env.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HARVEST_PROJECT_ID="${HARVEST_INFISICAL_PROJECT_ID:-${HARVEST_PROJECT_ID:-f7f058b6-d267-45c1-9311-e0962a74e923}}"
INFISICAL_DOMAIN="${INFISICAL_DOMAIN:-https://crypt.noirstack.com}"
INFISICAL_ENV="${INFISICAL_ENV:-prod}"
OUT_FILE="${HARVEST_ENV_FILE:-$ROOT/.env.harvest.local}"

if [[ -z "${INFISICAL_TOKEN:-}" && -f /home/hira/scripts/.infisical-token ]]; then
  # shellcheck disable=SC1091
  source /home/hira/scripts/.infisical-token
fi
if [[ -z "${INFISICAL_TOKEN:-}" ]]; then
  echo "ERROR: INFISICAL_TOKEN required (export or /home/hira/scripts/.infisical-token)" >&2
  exit 1
fi

hostify_dotenv() {
  node -e "
    const fs = require('fs');
    const text = fs.readFileSync(0, 'utf8');
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (!line || line.startsWith('#')) { console.log(line); continue; }
      const idx = line.indexOf('=');
      if (idx < 1) { console.log(line); continue; }
      const key = line.slice(0, idx);
      let val = line.slice(idx + 1).trim();
      if ((val.startsWith(\"'\") && val.endsWith(\"'\")) || (val.startsWith('\"') && val.endsWith('\"'))) {
        val = val.slice(1, -1);
      }
      if (key === 'HARVEST_DATABASE_URL' || key === 'DATABASE_URL') {
        try {
          const u = new URL(val);
          if (u.hostname === 'postgres-main') {
            u.hostname = '127.0.0.1';
            u.port = '5499';
            val = u.toString();
          }
        } catch {}
      }
      const escaped = val.replace(/'/g, \"'\\\\''\");
      console.log(key + \"='\" + escaped + \"'\");
    }
  "
}

echo "→ Infisical harvest project $HARVEST_PROJECT_ID ($INFISICAL_ENV)"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

{
  echo "# Generated from Infisical ($INFISICAL_DOMAIN)"
  echo "# Project: $HARVEST_PROJECT_ID ($INFISICAL_ENV)"
  echo "# $(date -u +%Y-%m-%dT%H:%M:%SZ)"
} >"$OUT_FILE"

infisical export \
  --projectId="$HARVEST_PROJECT_ID" \
  --env="$INFISICAL_ENV" \
  --domain="$INFISICAL_DOMAIN" \
  --token="$INFISICAL_TOKEN" \
  --format=dotenv >>"$TMP"

hostify_dotenv <"$TMP" >>"$OUT_FILE"
chmod 600 "$OUT_FILE" 2>/dev/null || true

KEY_COUNT="$(grep -cE '^[A-Z_]+=' "$OUT_FILE" || true)"
echo "Wrote $KEY_COUNT keys → $OUT_FILE"
echo "Start: npm run dev (loads .env.harvest.local via dotenv)"
