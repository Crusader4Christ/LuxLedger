# OpenAPI Contract Governance (LL-34 MVP)

## Scope

This policy governs contract drift detection and resolution for:

- `apps/luxledger-api/openapi/openapi.yaml`
- HTTP contract-surface implementation files:
  - `apps/luxledger-api/src/api/routes/**`
  - `apps/luxledger-api/src/api/schema/**`
  - `apps/luxledger-api/src/api/errors/**`
  - `apps/luxledger-api/src/api/server.ts`

Non-goal in LL-34: no reusable framework-agnostic contract-test implementation. That work is tracked in LL-50 (epic LL-46).

## CI Gating Policy

### Required check

- CI job: `OpenAPI Contract Governance`
- Trigger: pull requests
- Rule:
  - If any contract-surface file changes, `apps/luxledger-api/openapi/openapi.yaml` must also change in the same PR.

### Explicit fail conditions

CI fails when all are true:

1. PR changes one or more contract-surface files.
2. PR does not modify `apps/luxledger-api/openapi/openapi.yaml`.

This is treated as contract drift risk. Merge is blocked until resolved.

### Ownership and resolution

- PR author owns first response and remediation.
- API reviewers own verification that the remediation is correct.
- Allowed resolutions:
  - Update `openapi.yaml` so it matches runtime behavior.
  - Revert/adjust runtime changes so the contract is unchanged.

No exceptions for red CI from this check. PR stays blocked until green.

## Contributor Workflow

### When OpenAPI must be updated

Update `apps/luxledger-api/openapi/openapi.yaml` whenever API behavior changes, including:

- endpoint/path changes
- request payload/params/headers changes
- response shape/status code changes
- API error code/body changes exposed to clients

## Pre-merge checks

Before merge, all must be true:

1. `OpenAPI Contract Governance` CI check is green.
2. Existing required CI checks are green (unit/typecheck/integration).
3. PR checklist contract items are completed.
4. Reviewer checklist contract items are completed for contract-impacting PRs.

## Step-by-step flow

### Flow A: Contract changed

1. Implement API/runtime changes.
2. Update `apps/luxledger-api/openapi/openapi.yaml` in same PR.
3. Validate locally as needed (`bun run test:unit`, `bun run typecheck`, integration checks when relevant).
4. Mark contract-change items in PR template.
5. Request API review; reviewers verify runtime vs OpenAPI consistency.
6. Merge only after all required CI checks are green.

### Flow B: Contract unchanged

1. Implement internal-only change.
2. Do not modify `openapi.yaml`.
3. Mark PR template item confirming no contract impact.
4. Reviewers confirm contract surface is unchanged.
5. Merge only after all required CI checks are green.

## PR and Review Governance

- PR template includes deterministic contract assertions by author.
- Reviewer checklist is mandatory for API contract-impacting changes.
- "Looks fine" is not sufficient when contract files or contract-surface files changed.

## Ambiguity Guardrails

The LL-34 guard is intentionally lightweight and may miss drift from changes outside the scoped file list.

To avoid silent drift:

- If behavior visible to API clients changes from any file outside listed contract-surface paths, treat it as contract-impacting and update `openapi.yaml`.
- If uncertain, classify as contract-impacting.

Future hardening (LL-50) will provide broader automated mismatch detection.
