# LuxLedger
Financial core infrastructure: double-entry ledger domain packages, transport contracts, and persistence adapters.

## Local setup

1. Start PostgreSQL:
   `docker compose up -d`
2. Copy environment defaults:
   `cp .env.example .env`
3. Install dependencies:
   `bun install`
4. Migrate the local database:
   `bun run db:migrate`

The reference API demo app has been moved out of this repository so this repo can stay focused on the reusable ledger packages. New users should treat this repository as the library/core workspace and use the demo repository for an end-to-end runnable API.

## Test strategy

- `bun run test:unit` runs DB-free unit tests only.
- `bun run test:integration` requires PostgreSQL, verifies `DATABASE_URL_TEST`, resets the test database schema, runs migrations, and then runs the real-PostgreSQL integration suite serially.
- `bun run test:ci` runs the same split sequence that CI uses.
- `bun test` still runs every discovered test file, including integration tests, so only use it when the test database is available.

## Database prerequisites for tests

- Local application DB: `DATABASE_URL=postgresql://luxledger:luxledger@127.0.0.1:5432/luxledger`
- Local test DB: `DATABASE_URL_TEST=postgresql://luxledger:luxledger@127.0.0.1:5433/luxledger_test`
- To prepare only the test database schema locally:
  `bun run db:migrate:test`
- To reset the test database before rerunning integration tests:
  `bun run db:reset:test`
- Integration tests expect a real PostgreSQL instance. `docker compose up -d postgres_test` is enough when you only want the test database.

## CI strategy

- The unit job runs `bun run test:unit` and `bun run typecheck` without PostgreSQL.
- The integration job provisions PostgreSQL 16, checks connectivity, resets the ephemeral test database, runs migrations, and then runs the package integration suite.
- Pull requests must pass `OpenAPI Contract Governance`: deterministic verification fails on runtime/OpenAPI mismatch for governed contract surface.
- Local pre-push contract check: `bun run contract:verify`.

## Repository contents

- `packages/core`: domain model and application contracts.
- `packages/http`: framework-agnostic HTTP contracts and OpenAPI source.
- `packages/fastify-routes`: Fastify route registration package.
- `packages/express-routes`: Express route registration package.
- `packages/postgres-adapter`: Drizzle/PostgreSQL persistence adapter.
- `drizzle`: schema migrations shared by runnable applications.

## API contract

- OpenAPI contract governance policy (CI gating + PR/reviewer process) lives in `docs/governance/openapi-contract-governance.md`.
- Full docs index: `docs/README.md`.
- See API contract: `packages/http/openapi/openapi.yaml`.
