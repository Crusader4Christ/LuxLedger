# OpenAPI Contract Governance Gap Analysis (LL-35A Prep)

## Current State (As-Is)

### Governance artifacts inventoried

- CI workflow: `.github/workflows/ci.yml`
- Governance check script: `.github/scripts/check-openapi-contract-governance.sh`
- PR checklist template: `.github/pull_request_template.md`
- Governance policy doc: `docs/governance/openapi-contract-governance.md`
- Entry-point docs: `README.md`, `docs/README.md`

### Current CI fail conditions for OpenAPI drift

From `.github/scripts/check-openapi-contract-governance.sh` and CI wiring in `.github/workflows/ci.yml`:

- Job runs on pull requests only (`OpenAPI Contract Governance`).
- Script computes changed files between `BASE_SHA` and `HEAD_SHA`.
- Contract-surface is currently defined as:
  - `apps/luxledger-api/src/api/routes/**`
  - `apps/luxledger-api/src/api/schema/**`
  - `apps/luxledger-api/src/api/errors/**`
  - `apps/luxledger-api/src/api/server.ts`
- OpenAPI spec path enforced: `apps/luxledger-api/openapi/openapi.yaml`.
- CI fails only when both are true:
  1. At least one contract-surface file changed.
  2. `openapi.yaml` did not change.

### Current non-failing but relevant cases

- If `openapi.yaml` changes without contract-surface file changes, CI passes and only prints an informational message.
- If API behavior changes outside the defined contract-surface paths, CI does not fail.

## Gaps / Ambiguities Allowing Silent Drift

1. Path-list coverage gap
- Drift can occur when externally visible API behavior is modified from files not matched by the regex (for example service-layer behavior that affects response semantics, status mapping, or validation outcomes).

2. One-way gate only
- Current gate enforces "surface changed -> spec changed" but not "spec changed -> verified runtime change".
- Contract-only spec edits can pass without proving runtime consistency.

3. Diff-based presence check, not semantic check
- The check only verifies that `openapi.yaml` changed, not that the change is correct or sufficient.
- A minimal/no-op spec diff can satisfy the gate while drift remains.

4. PR checklist relies on manual truthfulness
- Template includes strong checklist items, but CI does not validate checklist assertions or reviewer completion.

5. PR-only enforcement window
- Governance job is PR-only; direct pushes to `main` are not checked by this job (branch protection may mitigate, but this is outside script enforcement).

## LL-35B Implementation Checklist (Concise, File-Targeted)

1. Tighten contract-surface detection in CI script
- Target: `.github/scripts/check-openapi-contract-governance.sh`
- Action: expand and normalize contract-impact file detection rules; keep deterministic and explicit.

2. Add explicit symmetric governance modes
- Target: `.github/scripts/check-openapi-contract-governance.sh`
- Action: introduce clear handling for:
  - runtime-surface change without spec change (fail)
  - spec-only change without declared/validated intent (policy-driven fail or required marker)

3. Wire stronger script outputs into CI logs
- Target: `.github/workflows/ci.yml`
- Action: preserve existing job, but ensure failure messages are actionable and unambiguous for authors/reviewers.

4. Codify stricter author/reviewer evidence requirements
- Target: `.github/pull_request_template.md`
- Action: refine checklist language to require explicit contract-impact declaration and verification evidence.

5. Align governance policy doc with enforced behavior
- Target: `docs/governance/openapi-contract-governance.md`
- Action: document exact enforcement matrix, accepted exceptions (if any), and required remediation paths.

6. Keep docs index and top-level references in sync
- Targets: `docs/README.md`, `README.md`
- Action: add/reference LL-35B policy updates so contributors discover the current process quickly.

## Notes for LL-35B Scope Discipline

- Keep implementation focused on governance hardening only.
- No runtime API behavior changes.
- No domain logic changes.
- No reusable framework construction in this phase.
