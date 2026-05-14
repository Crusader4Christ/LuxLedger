#!/usr/bin/env bash
set -euo pipefail

BASE_SHA=${1:-}
HEAD_SHA=${2:-}

if [[ -z "$BASE_SHA" || -z "$HEAD_SHA" ]]; then
  echo "Usage: $0 <base-sha> <head-sha>"
  exit 2
fi

if ! git cat-file -e "$BASE_SHA^{commit}" 2>/dev/null; then
  echo "Base SHA not available locally: $BASE_SHA"
  exit 2
fi

if ! git cat-file -e "$HEAD_SHA^{commit}" 2>/dev/null; then
  echo "Head SHA not available locally: $HEAD_SHA"
  exit 2
fi

changed_files=$(git diff --name-only "$BASE_SHA" "$HEAD_SHA")

if [[ -z "$changed_files" ]]; then
  echo "No file changes detected between base and head."
  exit 0
fi

contract_surface_regex='^apps/luxledger-api/src/api/(routes|schema|errors)/|^apps/luxledger-api/src/api/server\.ts$'
openapi_spec_path='apps/luxledger-api/openapi/openapi.yaml'

contract_surface_changed=0
openapi_changed=0

if printf '%s\n' "$changed_files" | rg -q "$contract_surface_regex"; then
  contract_surface_changed=1
fi

if printf '%s\n' "$changed_files" | rg -q "^${openapi_spec_path}$"; then
  openapi_changed=1
fi

if [[ "$contract_surface_changed" -eq 1 && "$openapi_changed" -eq 0 ]]; then
  echo "Contract governance check failed."
  echo "Detected API contract-surface changes but ${openapi_spec_path} was not updated."
  echo "Action: update openapi.yaml to match runtime behavior, or revert the contract-surface change."
  echo "See docs/governance/openapi-contract-governance.md for policy."
  exit 1
fi

echo "Contract governance check passed."
if [[ "$contract_surface_changed" -eq 1 ]]; then
  echo "Contract-surface changes detected and openapi.yaml updated."
fi
if [[ "$openapi_changed" -eq 1 && "$contract_surface_changed" -eq 0 ]]; then
  echo "openapi.yaml changed without detected contract-surface file changes."
  echo "Ensure this is an intentional contract-only/documentation change."
fi
