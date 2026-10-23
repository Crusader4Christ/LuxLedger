---
name: reviewer
description: Review a LuxLedger diff or pull request for actionable correctness and architecture defects. Use for code review rather than full acceptance testing.
---

# Review code changes

Find actionable defects introduced by the requested changes. Follow the user's review scope and applicable `AGENTS.md`. Repository paths below are relative to the repository root.

Optional [workflow helpers](../../references/workflow-helpers.md) collect Git context and run checks
with compact output. Read that reference only when using a helper; reuse established scope and gates.

## Establish the diff

- For a PR, inspect its actual base/head and current diff. For a branch, compare the merge base with the intended target to HEAD, for example `git diff origin/main...HEAD` when main is the target. For local changes, inspect staged, unstaged, and relevant untracked files; an empty `git diff` does not establish an empty review.
- Record the base/head references or commits and included local changes. Refresh remote references if their freshness matters; otherwise disclose that the review uses local references. Ask only if an ambiguous target would materially change the review.
- Understand the requested behavior from the user, issue, or PR, then trace changed code through relevant callers and tests. Check whether a suspected issue existed in the base before attributing it to the change.

## Inspect the changed guarantees

Use only the checks relevant to the diff:

- **Ledger correctness:** use `docs/product/invariants.md` and code/tests to check integer amounts, entry balance, currency/ledger consistency, immutable postings, and tenant scoping of reads and writes.
- **Consistency under failure/retry:** trace explicit transaction boundaries, partial rollback, same-payload retries, conflicting payload rejection, and concurrent writers. A unique `(tenant_id, reference)` index alone does not establish correct retry behavior.
- **Architecture and contracts:** check dependency direction, framework-free core/HTTP, application versus transport responsibilities, safe error mapping, OpenAPI/runtime agreement, and behavior across Fastify and Express. Consult `docs/governance/openapi-contract-governance.md` for HTTP changes.
- **Persistence and compatibility:** inspect generated migration SQL and metadata, existing-data upgrades, public exports, and affected consumers. Confirm test coverage addresses the changed failure modes.

Use focused tests only when they resolve a concrete uncertainty and the user's request permits execution. Use the shared compact runner for noisy checks; the shared boundary command covers HTTP guardrails only. Before database tests, inspect their setup and verify a disposable test target: these suites may drop schemas/truncate data and must run sequentially when sharing a database. A code review does not require an unconditional full CI run. Before recommending merge, verify applicable CI/governance gates for the reviewed revision, or state that readiness remains unverified.

## Report and hand off

- Present findings first, ordered by severity: P0 critical widespread failure, P1 urgent substantial impact, P2 normal actionable defect, P3 minor defect. Match priority to a supported failure scenario, not the financial domain alone.
- Each finding needs a short title, precise file and minimal verified line range in the reviewed diff, triggering conditions, and concrete consequence. If only an excerpt without line numbers is available, identify the symbol or changed expression and disclose that location limitation instead of inventing coordinates. Support the finding with code or reproduction evidence. Do not treat optional refactors, stylistic preferences, or unknown requirements as defects.
- Avoid duplicate findings for the same root cause. Exclude pre-existing defects unless explicitly asked to audit them, and exclude issues fixed by the current diff.
- Finish with the reviewed scope, checks actually performed, and material coverage gaps. If there are no actionable findings, say so without implying that every behavior was tested.

Review-only work preserves source files and returns feedback in the response. Publish a GitHub review/comment or Linear summary only when authorized by the user; honor authorization already given and report the actual result. Fixes, merging, and issue-status changes require their respective requested scope.
