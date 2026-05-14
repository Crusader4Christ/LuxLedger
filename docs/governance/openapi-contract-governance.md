# OpenAPI Contract Governance (LL-35B)

## Scope

This policy governs OpenAPI contract drift detection and remediation for:

- Contract file: `apps/luxledger-api/openapi/openapi.yaml`
- Runtime contract source: `apps/luxledger-api/src/api/contracts/transactions.ts`
- Deterministic verification test: `apps/luxledger-api/test/integration/openapi-contract-governance.integration.test.ts`

## CI Gating Policy

### Required check

- CI job: `OpenAPI Contract Governance`
- Trigger: pull requests
- Command: `.github/scripts/check-openapi-contract-governance.sh`
- Check command: `bun run contract:verify`

### Explicit fail conditions

CI must fail when deterministic verification detects any mismatch between runtime contract definitions and `apps/luxledger-api/openapi/openapi.yaml` for governed transaction contract surface.

Examples:

1. Runtime contract schema changes but `openapi.yaml` is not aligned.
2. `openapi.yaml` changes but no longer matches governed runtime contract definitions.
3. Required OpenAPI contract sections are missing or inconsistent with governed runtime contract fields/statuses.

A failed `OpenAPI Contract Governance` check blocks merge until green.

## Local Developer Workflow (Required)

Before push, authors must run:

1. `bun run contract:verify`
2. If it fails, update runtime contract definitions and/or `apps/luxledger-api/openapi/openapi.yaml` until it passes.

No PR is ready for review with a failing `contract:verify` result.

## Contributor and Reviewer Requirements

### Author must

1. Determine whether API contract behavior changed.
2. Update `apps/luxledger-api/openapi/openapi.yaml` when required.
3. Run `bun run contract:verify` locally and ensure pass.
4. Keep PR blocked until `OpenAPI Contract Governance` in CI is green.

### Reviewer must

1. Verify runtime API behavior in changed code is consistent with `apps/luxledger-api/openapi/openapi.yaml`.
2. Verify request/response/status/error definitions exposed to clients match the OpenAPI contract.
3. Require green `OpenAPI Contract Governance` before approval/merge.

## Resolution Rules

If governance fails, only these resolutions are allowed:

1. Update `apps/luxledger-api/openapi/openapi.yaml` to match runtime contract behavior.
2. Revert/adjust runtime contract behavior to match existing `openapi.yaml`.

No override process exists for red `OpenAPI Contract Governance`.
