#!/usr/bin/env bash
# Grant the VPS migration-cli machine identity access to the Harvest Infisical project.
# Requires a USER access token (not machine identity) with project admin rights.
#
# Usage:
#   INFISICAL_USER_TOKEN='<user-jwt>' ./scripts/infisical/grant-machine-identity.sh
set -euo pipefail

HARVEST_PROJECT_ID="${HARVEST_INFISICAL_PROJECT_ID:-f7f058b6-d267-45c1-9311-e0962a74e923}"
MACHINE_IDENTITY_ID="${MACHINE_IDENTITY_ID:-04f16cac-31c4-45b8-8971-e4d7098113d4}"
INFISICAL_DOMAIN="${INFISICAL_DOMAIN:-https://crypt.noirstack.com}"
TOKEN="${INFISICAL_USER_TOKEN:-}"

if [[ -z "$TOKEN" ]]; then
  echo "Set INFISICAL_USER_TOKEN (user JWT from crypt.noirstack.com → User Settings → Access Tokens)" >&2
  exit 1
fi

curl -fsS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"roles":[{"role":"admin","isTemporary":false}]}' \
  "$INFISICAL_DOMAIN/api/v1/projects/$HARVEST_PROJECT_ID/memberships/identities/$MACHINE_IDENTITY_ID"

echo ""
echo "Granted migration-cli admin on Harvest project $HARVEST_PROJECT_ID"
