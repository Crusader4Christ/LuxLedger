# LuxLedger

Public financial core infrastructure: a double-entry ledger. Runtime: Bun >= 1.x and PostgreSQL 16.
The reference API demo host lives in a separate repository.

## Instruction Scope

- This file applies repository-wide. Read applicable package-local `AGENTS.md` before editing.
- More specific instructions may refine these rules without weakening unrelated safety or workflow
  requirements. If instructions conflict or require an unapproved ownership change, stop and ask.
- Architecture rules describe intended boundaries. Verify code; existing violations are migration
  debt, not precedent. Do not perform incidental cross-package extractions.

## Architecture

| Package | Owns | Allowed runtime dependencies |
| --- | --- | --- |
| `core` | Domain invariants, application services, persistence ports, neutral orchestration | None |
| `http` | Transport contracts, schemas, DTO/error mapping, canonical OpenAPI | `core` |
| `fastify-routes`, `express-routes` | Framework adaptation to application services | `http`, `core`, own framework |
| `postgres-adapter` | PostgreSQL/Drizzle sessions, transactions, RLS, queries, mapping, locks | `core`, database libraries |

- Dependencies point inward toward core; production route adapters must not import each other.
  Packages must not import host applications. Keep framework/database dependencies out of core/HTTP.
- Reusable policy belongs in core. Broader orchestration currently in postgres-adapter is migration
  debt: do not extend it or move it unless the task includes extraction.
- Hosts own bootstrap, DI, configuration, authentication/authorization, rate limiting, observability,
  and shutdown. Keep provider/product-specific workflows there; consume public package exports.
- Import workspace packages only through declared `@luxledger/*` exports. Cross-package source
  imports are allowed only in tests explicitly enforcing repository boundaries.
- Treat exports, entry-point barrels, declaration build inputs, and README usage as one public API.
  Keep coordinated versions/dependency ranges aligned; never export internals merely for tests.

## Correctness

- Domain/application policy and errors belong in core; transport layers map safe errors and contain
  no business logic. Never leak database errors through the API.
- All state changes and balance updates require explicit transactions. Tenant queries set PostgreSQL
  tenant context in that same transaction. No soft deletes in core tables.
- Enforce idempotency with the unique `(tenant_id, reference)` index and core policy; database
  constraints are defense in depth, not the only expression of domain invariants.
- Preserve determinism, explicit inputs, small composable functions, and fail-fast invariants.
  No global state, silent failures, or side effects outside explicit transaction boundaries.
- Performance must not weaken correctness. Consult `docs/product/invariants.md` for affected behavior.
- Core invariant tests need positive and negative cases and must not mock core domain behavior.
  Core/HTTP unit tests are database-free; persistence/migration tests use real PostgreSQL.
- Runtime HTTP schemas, OpenAPI, and both adapters must agree on status, bodies, validation, and privacy.

## Working Efficiency and Changes

- Start with task-relevant files and targeted searches; broaden when dependencies or evidence require.
  Reuse results until the task or repository state changes.
- Use subagents only when authorized and useful. Research externally when current/external facts
  are needed; use repository evidence for project behavior.
- Make minimal focused edits, preserving existing behavior unless the task changes it. Avoid unrelated
  refactors, abstractions, dependency additions, and repository-wide formatting.
- Keep dependencies package-specific and justify additions in the PR. English only in code, comments,
  commits, and PRs. Documentation-only work must not trigger source-code churn.
- Keep progress and handoff concise: changes, verification, remaining gaps. Resolve routine choices
  from evidence; ask when missing information affects correctness/scope or authorization is required.

## Shared Worktree and Git

- Inspect status and relevant diffs before editing. Re-read files if concurrent edits are possible.
  Preserve others' changes; stop and coordinate on overlapping edits instead of overwriting them.
- Never reset, revert, delete, reformat, or stage unrelated work. Inspect staged diffs and stage only
  intended files/hunks. Rebase, amend, force-push, and shared-history rewrites need explicit permission.
- No direct commits to main. Branch: `LL-<number>-short-description` or `codex/LL-<number>-short-description`.
  PR title: `<ISSUE_ID> Short description`; include What, Why, How to test, Risks. Prefer <= 400 lines.
- Before creating a branch, always fetch `origin main` with escalation first and branch from latest main.
  Reuse the task branch for ongoing work. Never invent issue identifiers.
- For prose shell arguments use file input or quoted heredocs; never inline backticks.
- For Linear work, read the issue/criteria before implementation. Current code/docs take precedence over
  stale completed issues. Keep authorized status updates accurate and report validation/remaining gaps.

## Privacy and Restricted Files

- This repository (`Crusader4Christ/LuxLedger`) is public. Public repository facts may be copied to
  private LuxLedger Linear; never publish secrets, private attachments, customer/roadmap data,
  environment values, or unrelated private content into this repository or public artifacts.
- Do not read/edit/commit `node_modules/`, `packages/*/dist/`, `build/`, `tmp/`, `.tmp/`, `.temp/`,
  `.env*` (except tracked `.env.example`), `*.log`, `.codex/`, `.gokin/`, `ll-old/`, or `.idea/`.
- Exception: selectively inspect temporary verification logs created for the current task.
- Change `bun.lock` only with `bun install` after manifest edits. Generate migrations with
  `bun run db:generate`; never hand-edit generated `drizzle/` files.

## Required Verification

Use focused tests while developing, then complete the applicable gates. Reuse passing results only
while relevant code, configuration, dependencies, and environment are unchanged. Broaden for unresolved
risks; report blockers honestly. No circular dependencies or unverified claims of completion.

| Change | Required checks |
| --- | --- |
| Docs/instructions only | `git diff --check`; verify statements against code or label intended architecture/debt |
| Code | `bun run lint`, `bun run typecheck`, `bun run test:unit` |
| DB/schema or persistence | Code checks + `bun run test:integration` |
| Schema/migrations | Also `bun run migration:verify`; inspect generated SQL/metadata and assess existing-data upgrades |
| HTTP contract | Code checks + `bun run contract:verify` |
| Route adapter | Code checks + focused adapter tests + `bun test packages/express-routes/src/parity.test.ts` |
| Public exports/build/artifact shape | Code checks + `bun run build:packages`, `bun run pack:verify` |
| Dependencies/release metadata | Also `bun run release:verify` and relevant package checks |

- Before an authorized push run `bun run contract:verify`; see
  `docs/governance/openapi-contract-governance.md`. Full code acceptance follows CI, including integration.
- Database tests/reset/migration verification may drop schemas or truncate tables. Verify a dedicated
  disposable target (default local `luxledger_test` on :5433), preserve guards, and run shared-DB suites
  sequentially. A name containing `test` alone does not validate an overridden target.
- For scripts outside the main TS config, also run `bun run typecheck:test` where applicable.

## Task Resources

- Package-local `AGENTS.md` owns package-specific implementation detail.
- `docs/contributing.md`: setup, commands, Git/Linear procedures, final boundary checklist.
- `.agents/skills/`: `developer` implements, `qa` validates acceptance, `reviewer` reviews diffs,
  `cto` refines plans. Shared helpers are commands, not additional overlapping skills.
- `python3 scripts/agent_tools.py task-context [--base REF]`: compact local task inventory.
- `python3 scripts/agent_tools.py verify-change [--base REF]`: suggested gates; inspect semantic
  changes/local instructions before execution. Helpers cannot prove complete acceptance coverage.
