---
name: developer
description: Implement LuxLedger application or package code from a request or Linear issue. Use for implementation, not planning-only or review-only requests.
---

# Implement a repository change

Implement the requested behavior through verification and handoff. The user's scope and applicable `AGENTS.md` govern the work. Repository paths below are relative to the repository root.

Optional [workflow helpers](../../references/workflow-helpers.md) collect Git context and run checks
with compact output. Read that reference only when using a helper; reuse established scope and gates.

## Establish scope and Git state

- Read the request and acceptance criteria. Retrieve a referenced Linear issue and relevant discussion if tools are available; use supplied issue text when sufficient. Missing Linear access must not block work whose requirements are already available.
- Inspect `git status`, the current branch, and the relevant implementation/tests. Reuse a task branch when continuing work. For a new issue task, use the actual issue ID and repository branch naming convention. Before creating a new task branch, fetch `origin main` with escalation as required by `AGENTS.md`, then branch from the fetched main, not an unrelated current HEAD. Preserve user changes; use isolation when necessary. Do not invent a Linear ID.
- Resolve only questions that materially change behavior or scope. Otherwise make the smallest compatible choice and state significant assumptions.

## Implement at the correct boundary

- Keep domain rules and application services in core, transport contracts and error mapping in `packages/http`, framework wiring in the Fastify/Express adapters, and database implementation in `packages/postgres-adapter`. Core and HTTP must not acquire framework or persistence runtime dependencies. Host configuration belongs in the separate host application.
- Consult `docs/product/invariants.md` for affected ledger behavior and verify it against code/tests. For persistence changes, trace tenant scoping, explicit transaction boundaries, rollback, and idempotent retries including payload conflicts and concurrent requests. Preserve integer money representation and immutable postings where relevant.
- Schema changes require a migration under `drizzle/` and its generated metadata. Use the named migration command from `package.json`; inspect generated SQL for compatibility and data effects.
- Public HTTP changes require aligned runtime contracts and `packages/http/openapi/openapi.yaml`, including behavior in both framework adapters. Follow `docs/governance/openapi-contract-governance.md`.
- Cover changed behavior with meaningful tests. Core invariants need positive and negative cases; persistence guarantees need the real PostgreSQL test database. Do not mock core domain logic. Avoid unrelated refactors or new abstractions/dependencies without a task-specific reason.

## Verify against the repository workflow

Use the root verification matrix and applicable local instructions as the canonical gates. Read
`package.json` and `.github/workflows/ci.yml` when command behavior or full CI readiness matters.

- Use the optional verification planner when selecting gates is nontrivial; otherwise run the
  established commands directly. Inspect semantic scope and add focused behavior tests as needed.
- Full code acceptance includes integration and applicable CI gates. Before executing database gates, independently
  verify the effective dedicated disposable target and preserve existing guards. Shared-DB suites run
  sequentially. Migration verification covers clean migration and restore, not all existing-data upgrades.
- Run selected gates through `python3 scripts/run_compact.py -- <command>` or the helper's `--run`.
  Before authorized pushes also run `bun run contract:verify`, as required by contract governance.
- Fix failures introduced by this task and rerun affected checks. Report environmental blockers,
  unrelated failures, user testing restrictions, and remaining gates without claiming an unverified pass.

## Handoff and authorized actions

Summarize behavior, key paths, acceptance-criteria coverage, commands/results, and remaining gaps. Carry out commits, pushes, PR creation, or Linear updates when included in the user's request or earlier authorization; do not ask again for the same action. Otherwise stop at the local implementation. When committing, stage only intended changes, including new files; select hunks if a file also contains unrelated user edits. Never use `git commit -am` as a substitute for checking the staged diff. Use the repository PR structure (What, Why, How to test, Risks) with verified current paths, and report only successful actions. Merge or issue-status changes require their own authorization.
