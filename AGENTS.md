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
src/
  core/     — domain logic, ledger invariants, pure functions
  api/      — Fastify routes, schemas, hooks
  db/       — Drizzle schema, migrations, queries
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
- `DATABASE_URL` — `postgresql://luxledger:luxledger@localhost:5432/luxledger`
- `DATABASE_URL_TEST` — `postgresql://luxledger:luxledger@localhost:5433/luxledger_test`
- `NODE_ENV` — `development` | `production` | `test`

## Git Workflow
- Branch name: `<ISSUE_ID>-short-description`
- PR title: `<ISSUE_ID> Short description`
- PR must include:
  - What
  - Why
  - How to test
  - Risks
- No direct commits to main
- Small PRs (≤ 400 lines if possible)

## Definition of Done
- All core invariants covered by tests
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
- Core throws domain errors only
- API maps domain errors to HTTP responses
- No database errors leaked to API

## Testing Rules
- No mocks for core logic
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
- Tests required for all core invariants (double-entry balance, idempotency)
- Dependency direction: api → core ← db
- Core must not import from api or db implementations.
- Core may depend only on domain interfaces.
- Core layer must have zero external runtime dependencies.
