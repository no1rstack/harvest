#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARTIFACT_DIR="${ROOT_DIR}/artifacts/review"
OPENAPI_FILE="${ROOT_DIR}/openapi/harvest-v1.openapi.yaml"
SCHEMATHESIS_BASE_URL="${SCHEMATHESIS_BASE_URL:-}"
ZAP_TARGET_URL="${ZAP_TARGET_URL:-${SCHEMATHESIS_BASE_URL:-}}"

mkdir -p "${ARTIFACT_DIR}"

log() {
  printf '\n[%s] %s\n' "$1" "$2"
}

run_or_note() {
  local binary="$1"
  shift
  if command -v "$binary" >/dev/null 2>&1; then
    "$@"
  else
    log SKIP "${binary} not installed"
  fi
}

log STEP "1/6 npm test"
npm test | tee "${ARTIFACT_DIR}/npm-test.txt"

log STEP "2/6 npm build"
npm run build | tee "${ARTIFACT_DIR}/npm-build.txt"

log STEP "3/6 semgrep"
run_or_note semgrep semgrep scan --config "${ROOT_DIR}/.semgrep/harvest.yml" --json --output "${ARTIFACT_DIR}/semgrep.json" "${ROOT_DIR}"

log STEP "4/6 gitleaks"
run_or_note gitleaks gitleaks detect --source "${ROOT_DIR}" --config "${ROOT_DIR}/.gitleaks.toml" --report-format json --report-path "${ARTIFACT_DIR}/gitleaks.json"

log STEP "5/6 trivy"
run_or_note trivy trivy fs --config "${ROOT_DIR}/trivy.yaml" --output "${ARTIFACT_DIR}/trivy.txt" "${ROOT_DIR}"

if [[ -n "${SCHEMATHESIS_BASE_URL}" ]]; then
  log STEP "6/6 schemathesis"
  run_or_note schemathesis schemathesis run --url "${SCHEMATHESIS_BASE_URL}" --report-junit-path "${ARTIFACT_DIR}/schemathesis-junit.xml" "${OPENAPI_FILE}"
else
  log SKIP "schemathesis skipped; set SCHEMATHESIS_BASE_URL"
fi

if [[ -n "${ZAP_TARGET_URL}" ]]; then
  log STEP "zap baseline"
  run_or_note zap-baseline.py zap-baseline.py -t "${ZAP_TARGET_URL}" -r "${ARTIFACT_DIR}/zap-report.html" -w "${ARTIFACT_DIR}/zap-report.md" -c "${ROOT_DIR}/.zap/rules.tsv"
else
  log SKIP "ZAP skipped; set ZAP_TARGET_URL or SCHEMATHESIS_BASE_URL"
fi

log DONE "Artifacts written to ${ARTIFACT_DIR}"
