#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$ROOT_DIR/.env"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [ -z "${WS_SHARED_SECRET:-}" ]; then
  echo "WS_SHARED_SECRET is required (set in .env or environment)." >&2
  exit 1
fi
if [ -z "${ALEXA_SKILL_ID:-}" ]; then
  echo "ALEXA_SKILL_ID is required (set in .env or environment)." >&2
  exit 1
fi

cd "$ROOT_DIR"

npm run build

cdk deploy SldBltProdStack --require-approval never \
  --parameters WsSharedSecret="$WS_SHARED_SECRET" \
  --parameters AlexaSkillId="$ALEXA_SKILL_ID"
