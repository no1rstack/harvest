#!/usr/bin/env bash
# Daily collection → Target Registry due targets → Cascades workflow enqueue.
# Syncs HARVEST_DATABASE_URL, seeds registry from targets.txt, submits passive-domain-collection runs.
#
# Usage:
#   ./scripts/osint-harvest/daily-pull.sh
#   ./scripts/osint-harvest/daily-pull.sh --dry-run
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

TARGETS_FILE="${TARGETS_FILE:-$ROOT/scripts/osint-harvest/targets.txt}"
LOG_DIR="${OSINT_HARVEST_LOG_DIR:-$ROOT/logs/osint-harvest}"
DRY_RUN=0
SYNC_INFISICAL="${SYNC_INFISICAL:-1}"

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --no-sync) SYNC_INFISICAL=0 ;;
    --help|-h)
      sed -n '2,10p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
  esac
done

mkdir -p "$LOG_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$LOG_DIR/daily-$STAMP.log"
SUMMARY="$LOG_DIR/latest-summary.json"
exec > >(tee -a "$LOG") 2>&1

echo "=== Collection Platform daily $STAMP ==="
echo "root=$ROOT"
echo "targets_file=$TARGETS_FILE"
echo "dry_run=$DRY_RUN"
echo "log=$LOG"

if [[ -z "${INFISICAL_TOKEN:-}" && -f /home/hira/scripts/.infisical-token ]]; then
  # shellcheck disable=SC1091
  source /home/hira/scripts/.infisical-token
fi

if [[ "$SYNC_INFISICAL" == "1" ]]; then
  echo "--- sync Infisical HARVEST_DATABASE_URL ---"
  npm run osint:db:sync -- harvest
fi

if [[ -f "$ROOT/.env.harvest.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env.harvest.local"
  set +a
  export DATABASE_URL="${HARVEST_DATABASE_URL:-$DATABASE_URL}"
  export HARVEST_DATABASE_URL="${HARVEST_DATABASE_URL:-$DATABASE_URL}"
  export H3XA_PG_HOST_REWRITE=0
fi

echo "--- seed Target Registry from targets.txt ---"
npm run osint:registry:seed

COLLECT_ARGS=(run osint:collect -- --due)
if [[ "$DRY_RUN" == "1" ]]; then
  COLLECT_ARGS+=(--dry-run)
fi

echo "--- enqueue due collections via Cascades ---"
set +e
OUT="$(npm "${COLLECT_ARGS[@]}" 2>&1)"
RC=$?
set -e
echo "$OUT"

FINISHED="$(date -u +%Y%m%dT%H%M%SZ)"
node -e "
const raw = process.argv[1];
let parsed = { engine: 'cascades', submissions: 0, failed: 0, results: [] };
const m = raw.match(/COLLECTION_DUE=({.*})/s);
if (m) {
  try { parsed = JSON.parse(m[1]); } catch {}
}
const results = parsed.results || [];
const s = {
  startedAt: process.argv[2],
  finishedAt: process.argv[3],
  store: 'harvest',
  platform: 'collection',
  engine: parsed.engine || 'cascades',
  targetsFile: process.argv[4],
  dryRun: process.argv[5]==='1',
  submissions: parsed.submissions || results.length,
  failed: parsed.failed || 0,
  cascadesRunIds: results.map(r => r.cascades_run_id).filter(Boolean),
  log: process.argv[6],
  results,
};
require('fs').writeFileSync(process.argv[7], JSON.stringify(s,null,2)+'\n');
console.log(JSON.stringify(s,null,2));
" "$OUT" "$STAMP" "$FINISHED" "$TARGETS_FILE" "$DRY_RUN" "$LOG" "$SUMMARY"

echo "=== done rc=$RC ==="
exit "$RC"
