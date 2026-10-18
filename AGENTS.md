# LuxLedger
Financial core infrastructure — double-entry ledger component.

## Runtime
- Bun >= 1.x
- PostgreSQL 16

## Stack
- Fastify adapter package for Fastify hosts
- Express adapter package for Express hosts
- Drizzle ORM — database layer
- No framework dependency in `@luxledger/core` or `@luxledger/http`

## Project Structure
```
packages/
  core/
    src/
      base/         — shared primitives (Id, Money, DomainError, etc.)
      application/  — app-facing contracts and app-level errors
      utils/        — reusable helpers (e.g. assertNonEmpty)
      */            — domain modules (tenant, ledger, account, transaction, entry,
                       api-key, credit-grant, reconciliation)
  http/             — framework-agnostic HTTP contracts and OpenAPI source
  fastify-routes/   — Fastify route registration package (@luxledger/fastify-routes)
  express-routes/   — Express route registration package (@luxledger/express-routes)
  postgres-adapter/ — narrow Drizzle/PostgreSQL persistence adapter
```

## Instruction Scope and Precedence

- This root file applies repository-wide.
- A package-local `AGENTS.md` applies only within its directory tree and may add or override rules for
  that package.
- When rules differ, follow the most specific applicable instruction. A local rule does not weaken an
  unrelated repository-wide safety, privacy, or workflow requirement.
- If applicable instructions still conflict or would require a structural ownership change, do not
  guess. Stop and ask before moving code or changing public behavior.
- These instructions describe intended constraints, not proof that the current code already satisfies
  them. Verify the implementation. Treat a mismatch as technical debt or a follow-up unless the task
  explicitly includes correcting that boundary.

## Package Architecture

- `@luxledger/core` owns domain types, invariants, application services, persistence ports, and
  persistence-neutral orchestration. It has no external runtime dependencies.
- `@luxledger/http` owns framework-neutral transport contracts, schemas, DTO mappers, safe error
  mapping, shared route primitives, and the canonical OpenAPI document. It may depend only on
  `@luxledger/core` at runtime.
- `@luxledger/fastify-routes` and `@luxledger/express-routes` translate their framework request and
  response APIs to `@luxledger/core/application` services using `@luxledger/http` contracts. They do
  not own business rules or construct persistence services.
- `@luxledger/postgres-adapter` is a PostgreSQL/Drizzle implementation of core persistence ports. Its
  target boundary is deliberately narrow: PostgreSQL sessions, SQL transactions, RLS context,
  Drizzle schema/query implementations, row mapping, locking primitives, and database-error
  translation.
- Some persistence-neutral orchestration currently lives in `packages/postgres-adapter`; that is
  migration debt, not a precedent or evidence that the boundary is already enforced. Do not add new
  reusable policy there. Existing misplaced code may remain until an explicitly scoped extraction
  task moves it.

Dependency direction:

```text
host applications
  -> fastify-routes | express-routes
  -> postgres-adapter

fastify-routes | express-routes -> http -> core
postgres-adapter -> core
```

- Production code in one route adapter must not import the other route adapter.
- `core` must not import `http`, route adapters, database adapters, or host applications.
- `http` must not import route frameworks, database libraries, database adapters, or host
  applications.
- `postgres-adapter` must not import `http`, route adapters, or host applications.

## Change Discipline

- Prefer the smallest change that satisfies the task and preserve existing behavior unless the task
  explicitly changes it.
- Do not perform a cross-package refactor merely to make existing code match the intended architecture.
  Move code across boundaries only when the task explicitly includes that cleanup or the requested
  change cannot be implemented correctly without it.
- When an out-of-scope boundary violation is discovered, avoid extending it and report or track it as
  follow-up work.
- Documentation-only tasks must not trigger source-code churn by default.

## Parallel Agent Workflow

- Assume the worktree may contain concurrent user or agent edits. Check `git status` and the relevant
  diff before editing, then re-read a file immediately before changing it if another process may have
  touched it.
- Preserve changes you did not create. Do not reset, revert, overwrite, reformat, or delete unrelated
  work to make the tree clean.
- Keep edits narrowly scoped and avoid repository-wide format/fix commands unless the task explicitly
  requires them.
- Before committing, inspect the staged diff and stage only the files intended for the current task.
  Do not absorb another agent's changes into the commit merely because they share the worktree.
- If concurrent edits overlap the same lines or make ownership ambiguous, stop and coordinate instead
  of choosing one version silently.
- Rebase, amend, force-push, or rewrite shared history only with explicit user authorization.

## Host Composition Boundary

- Host applications are thin composition roots. They own process bootstrap, dependency injection,
  environment/config loading, authentication, authorization integration, rate limiting, framework
  plugin registration, observability wiring, and graceful shutdown.
- Hosts consume public package exports. Do not duplicate package route contracts, domain policy, or
  persistence implementations in a host.
- Provider- or product-specific workflows belong in the owning host/product package; keep the ledger
  packages provider-neutral.

## Commands
- `bun install` — install dependencies
- `bun test` — run tests
- `bun run lint` — lint
- `bun run typecheck` — type check
- `bun run db:generate` — generate a named migration from the Drizzle schema
- `bun run db:migrate` — apply migrations

## Repo Map
- `packages/*` — all source; each package has its own `src/` (tests live beside code or in `test/integration/`)
- `drizzle/`, `drizzle.config.ts` — SQL migrations and Drizzle config
- `scripts/` — release, DB, and verification scripts
- `docs/` — ADRs, runbooks, schema and product docs
- `.github/` — CI workflows and PR template

## Ignore List (do not read, edit, or commit)
- `node_modules/`, `packages/*/dist/`, `build/`, `tmp/`, `.tmp/`, `.temp/`
- `.env*` (only `.env.example` is tracked), `*.log`
- `.codex/`, `.gokin/`, `ll-old/`, `.idea/`
- `bun.lock` — change only via `bun install` after manifest edits
- `drizzle/` generated migrations — never hand-edit; generate via `bun run db:generate`

## Minimal Verification
- Docs/instructions-only change: run `git diff --check` and confirm statements match either the current
  implementation or are clearly labeled as intended architecture/technical debt.
- Code change: `bun run lint && bun run typecheck && bun run test:unit`
- DB/schema change: add `bun run test:integration` (needs `docker compose up -d`)
- HTTP contract change: add `bun run contract:verify`
- Route adapter change: add focused adapter tests and run
  `bun test packages/express-routes/src/parity.test.ts`.
- Package export or build change: add `bun run build:packages` and `bun run pack:verify` when the
  published artifact shape can change.

## Public Packages

- Treat `package.json` `exports`, package entry-point `index.ts` files, declaration build inputs, and
  README usage as one public API surface; update them together.
- Only paths declared by a package's `package.json` `exports` are public entry points. Unexported
  modules, including any `internal`, `private`, or implementation directory, are internal APIs even if
  TypeScript can resolve them.
- Import another workspace package through an exported `@luxledger/*` entry point. Do not deep-import
  its `src`, `lib`, internal, or private files. Cross-package source imports are allowed only in tests
  that explicitly enforce repository-wide boundaries.
- Keep coordinated package versions and internal dependency ranges aligned for releases.
- Avoid exporting adapter internals merely to make tests convenient.

## Boundary Review Checklist

Before finishing a change, verify:

- the package dependency direction still points inward toward `core`;
- new imports use public exports and do not create cross-boundary coupling;
- public exports, barrel files, declaration build inputs, and package metadata remain aligned;
- all package-local instructions applicable to the changed files were followed;
- documentation distinguishes current behavior from intended architecture; and
- the verification commands match the type of change described above.

## Local Setup
```sh
docker compose up -d          # PostgreSQL on :5432, test DB on :5433
cp .env.example .env          # configure DATABASE_URL
bun install
bunx drizzle-kit migrate
```

The reference API demo app lives in a separate repository. This repository owns the reusable packages, migrations, and HTTP/OpenAPI contract.

## Repository Visibility
- This repository (`Crusader4Christ/LuxLedger`) is public.
- Public technical information from this repository may be copied into the private LuxLedger Linear workspace without redaction or additional confidentiality confirmation.
- This does not authorize sharing secrets, credentials, private attachments, local environment values, or information from other private sources.

## Environment Variables
- `DATABASE_URL` — `postgresql://luxledger:luxledger@127.0.0.1:5432/luxledger`
- `DATABASE_URL_TEST` — `postgresql://luxledger:luxledger@127.0.0.1:5433/luxledger_test`
- `NODE_ENV` — `development` | `production` | `test`

## Git Workflow
- Branch name: `LL-<number>-short-description` (or `codex/LL-<number>-short-description`)
- PR title: `<ISSUE_ID> Short description`
- PR must include:
  - What
  - Why
  - How to test
  - Risks
- No direct commits to main
- Small PRs (≤ 400 lines if possible)
- Always run `git fetch origin main` (or equivalent fetch from `main`) with escalation first, so branch creation is guaranteed from the latest `main` without sandbox retry loops.
- When passing shell arguments that include prose (for example `gh pr create --body`), never use backticks in the inline argument text because `zsh` treats them as command substitution. Prefer plain text without backticks, single-quoted heredoc (`<<'EOF'`), or file-based body input.

## Linear Work Tracking

- For Linear-backed work, read the issue before implementation and use its scope, acceptance criteria,
  and test matrix to guide the change. Repository code and current documentation take precedence over
  stale implementation detail in completed issues.
- Put the Linear issue identifier in the branch and PR title so Git integration can link the work.
- Keep issue status accurate while work is active and summarize validation or remaining gaps before
  completion.
- This repository is public. Do not copy private roadmap details, customer data, credentials, private
  attachments, or unrelated Linear content into source, documentation, commits, or PRs. Only bring
  across engineering decisions that are authorized for this repository and relevant to the change.

## Definition of Done
- All `@luxledger/core` domain invariants covered by tests
- Relevant unit and integration tests pass
- `bun run typecheck` passes
- No circular dependencies
- No business logic in HTTP or framework route layers
- Migrations included when schema changes
- Runtime HTTP schemas, OpenAPI, and both framework adapters remain behaviorally aligned

## Database Rules
- All state-changing operations must run inside explicit transaction
- No implicit balance recalculation outside transaction
- Idempotency enforced via unique index (tenant_id, reference)
- No soft deletes in core tables
- Tenant-scoped operations set PostgreSQL tenant context inside the same transaction as their queries.
- Domain/application policy belongs in `core`; database constraints are defense in depth and must not
  become the only expression of a business invariant.
- Generate migrations with `bun run db:generate`; never hand-edit generated migration files.

## Error Policy
- Domain (`@luxledger/core`) throws domain/application errors only
- API maps domain/application errors to HTTP responses
- No database errors leaked to API

## Testing Rules
- No mocks for `@luxledger/core` domain logic
- Core and HTTP unit tests remain database-free.
- Persistence and migration integration tests use the real PostgreSQL test database, never an
  in-memory database substitute.
- Each invariant must have positive and negative test case
- Framework adapters must expose equivalent status codes, response bodies, validation semantics, and
  error privacy for the shared contract surface.

## Rules

- English only (code, comments, commits, PRs).
- No hidden magic. Prefer explicit over implicit.
- Determinism first: same input → same state transition.
- No side effects outside explicit transaction boundaries.
- No silent failures. Fail fast on invariant violations.
- Avoid premature abstractions and generic layers.
- Keep functions small and composable.
- No global state.
- No business logic inside HTTP handlers.
- Performance considerations must not break correctness.
- Any dependency addition must be justified in PR description.
- Keep dependencies package-specific and minimal; never add a framework or database dependency to a
  more central package for adapter convenience.
- Tests required for all `@luxledger/core` invariants (double-entry balance, idempotency)
