---
name: qa
description: Verify implemented LuxLedger behavior against an issue or acceptance criteria with tests and evidence. Use for QA and acceptance validation.
---

# Validate an implementation

Determine whether the implementation meets its requirements. Follow the user's scope and applicable `AGENTS.md`. Repository paths below are relative to the repository root.

Optional [workflow helpers](../../references/workflow-helpers.md) collect Git context and run checks
with compact output. Read that reference only when using a helper; reuse established scope and gates.

## Define what is being validated

- Read the issue/request and acceptance criteria; retrieve referenced Linear context when available. If criteria are missing, derive clearly labeled checks from the request and documented behavior. Ask only if a missing decision prevents a meaningful verdict.
- Record the target branch/commit and scope. For a PR, use its actual base and head; for a branch, use the merge base with its intended target; for local work, include staged, unstaged, and relevant untracked files. State the baseline and any local changes so the evidence identifies the version checked.
- Map each acceptance criterion to a test or inspection and its expected result. Existing test names or green CI alone do not prove that every criterion is covered.

## Exercise the relevant behavior

- Consult `docs/product/invariants.md` for ledger changes. Select positive, negative, and boundary cases appropriate to the change: tenant isolation, valid/invalid postings, identical retry versus changed payload, concurrency, rollback of partial writes, and immutable reversal/correction behavior.
- Use actual core logic and real PostgreSQL for persistence behavior. For HTTP changes, check runtime contracts, OpenAPI, error responses, and Fastify/Express parity; use `packages/http/src/test` and the adapter tests as starting points.
- Choose commands from current `package.json` and `.github/workflows/ci.yml`. For full code acceptance, run `bun run test:ci`, `bun run typecheck`, and `bun run lint`; for a narrow request, execute its focused checks and explicitly limit the verdict. Include contract, migration, or package checks when relevant. Do not run the entire CI suite merely to validate prose.
- Use the shared verification planner for candidate gates and the compact runner for noisy checks;
  acceptance criteria and observed behavior determine the verdict, not the planner output.
- Integration tests and `migration:verify` reset/truncate the target database. Verify it is the dedicated disposable test database before execution; the default is local `luxledger_test` on port 5433. Inspect overridden targets without printing credentials. Run tests sharing that database sequentially and preserve the existing target guards. `migration:verify` checks clean migration and backup/restore; an upgrade requirement needs separate evidence.
- A request to validate authorizes appropriate local checks and disposable test fixtures. Preserve tracked source and test files unless the user also requests changes. Do not fix implementation defects as part of a validation-only task. Honor explicit restrictions such as inspection-only or no test execution.

## Report an evidence-based verdict

For each criterion, provide **PASS**, **FAIL**, or **BLOCKED**, plus the relevant command/output, test location, or code evidence. PASS requires evidence appropriate to the claim: static inspection can establish dependency direction, but cannot establish a concurrent runtime guarantee by itself. A skipped runtime check is not a pass. Distinguish environment/tooling blockers from a demonstrated product defect.

For defects, include the affected criterion, expected versus actual behavior, reproducible input or steps, impact/severity, and file/line where available. Use P0 for a critical widespread failure, P1 for urgent substantial impact, P2 for a normal actionable defect, and P3 for a minor defect. State an overall verdict and any unverified coverage; do not bury partial validation under a blanket pass.

Return the report locally unless a Linear update/comment was authorized in this conversation. Honor existing authorization, identify the correct issue, and report the actual write result. A QA report alone does not authorize changing issue status.
