#!/usr/bin/env bash
set -euo pipefail

# LL-35B: Deterministic contract governance check.
# We intentionally ignore base/head diff heuristics and validate the current repo state directly.
# This closes silent-drift paths where behavior/contracts changed outside a predefined file list.

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  echo "Usage: $0"
  echo "Runs deterministic OpenAPI contract verification."
  exit 0
fi

echo "Running OpenAPI contract governance verification..."

echo "Command: bun run contract:verify"
if ! bun run contract:verify; then
  echo ""
  echo "OpenAPI contract governance check failed."
  echo "Required action: align runtime API contract behavior and apps/luxledger-api/openapi/openapi.yaml."
  echo "Then rerun: bun run contract:verify"
  echo "See docs/governance/openapi-contract-governance.md for mandatory process."
  exit 1
fi

echo "OpenAPI contract governance check passed."
