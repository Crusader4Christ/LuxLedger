# LuxLedger
Financial core infrastructure — double-entry ledger component.

## Runtime
- Bun >= 1.x
- PostgreSQL 16

## Stack
- Fastify — HTTP server
- Drizzle ORM — database layer
- No frameworks (no NestJS, no Express)

## Project Structure
```
apps/
  luxledger-api/
    src/
      services/ — application services, validation, orchestration
      api/      — Fastify routes, schemas, hooks
packages/
  ledger/
    src/
      base/         — shared primitives (Id, Money, DomainError, etc.)
      application/  — app-facing contracts and app-level errors
      utils/        — reusable helpers (e.g. assertNonEmpty)
      */            — domain modules (tenant, ledger, account, transaction, entry, api-key)
  ledger-drizzle-adapter/  — Drizzle/Postgres adapter (@lux/ledger-drizzle-adapter)
```

## Commands
- `bun install` — install dependencies
- `bun run dev` — start dev server
- `bun test` — run tests
- `bun run lint` — lint
- `bun run typecheck` — type check
- `bunx drizzle-kit generate` — generate migration from schema
- `bunx drizzle-kit migrate` — apply migrations

## Local Setup
```sh
docker compose up -d          # PostgreSQL on :5432, test DB on :5433
cp .env.example .env          # configure DATABASE_URL
bun install
bunx drizzle-kit migrate
bun run dev
```

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

## Definition of Done
- All `@lux/ledger` domain invariants covered by tests
- `bun test` passes
- `bun run typecheck` passes
- No circular dependencies
- No business logic in api layer
- Migrations included when schema changes

## Database Rules
- All state-changing operations must run inside explicit transaction
- No implicit balance recalculation outside transaction
- Idempotency enforced via unique index (tenant_id, reference)
- No soft deletes in core tables

## Error Policy
- Domain (`@lux/ledger`) throws domain/application errors only
- API maps domain/application errors to HTTP responses
- No database errors leaked to API

## Testing Rules
- No mocks for `@lux/ledger` domain logic
- Use real PostgreSQL test DB
- Each invariant must have positive and negative test case

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
- Minimum dependencies (Fastify + Drizzle, nothing else unless justified)
- Tests required for all `@lux/ledger` invariants (double-entry balance, idempotency)
- Dependency direction:
  - `apps/luxledger-api/src/api` → `apps/luxledger-api/src/services`
  - `apps/luxledger-api/src/services` → `@lux/ledger` and `@lux/ledger/application`
  - `packages/ledger-drizzle-adapter` → `@lux/ledger` and `@lux/ledger/application` (never `apps/*`)
- `@lux/ledger` must not import from `apps/*` or adapter implementations.
- `@lux/ledger` domain layer must have zero external runtime dependencies.
