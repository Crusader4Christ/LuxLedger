# OpenAPI Contract Governance Gap Analysis (LL-35A Prep)

## Current State

The LL-35A governance gaps are closed by deterministic verification:

- CI workflow: `.github/workflows/ci.yml`
- Governance check script: `.github/scripts/check-openapi-contract-governance.sh`
- PR checklist template: `.github/pull_request_template.md`
- Governance policy doc: `docs/governance/openapi-contract-governance.md`
- Contract source: `packages/http/src/contracts`
- OpenAPI source: `packages/http/openapi/openapi.yaml`
- Verification command: `bun run contract:verify`

The reference API demo app now lives outside this repository. Contract governance stays in the package repository because `@luxledger/http` owns the framework-agnostic request and response contract.

## Previously Identified Gaps

1. Path-list coverage gap: replaced by deterministic contract verification.
2. One-way gate only: replaced by a verification command that compares expected contract semantics with the OpenAPI source.
3. Diff-based presence check: replaced by a current-state check.
4. PR checklist reliance: still exists as reviewer process, backed by CI verification.
5. PR-only enforcement window: the governance job still runs on pull requests; branch protection should prevent unchecked direct merges.

## Maintenance Notes

- Keep `packages/http/openapi/openapi.yaml` and `packages/http/src/contracts` aligned in the same PR.
- Keep `bun run contract:verify` green before review.
- Move demo-app-specific OpenAPI serving, Swagger UI, auth bootstrap, and deployment checks to the separate demo repository.
