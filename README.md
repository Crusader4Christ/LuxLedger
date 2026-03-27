# LuxLedger
financial core infrastructure

## Local setup

1. Start PostgreSQL:
   `docker compose up -d`
2. Copy environment defaults:
   `cp .env.example .env`
3. Install dependencies:
   `bun install`
4. Migrate the application database:
   `bun run db:migrate`
5. Start the API:
   `bun run dev`

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
- The integration job provisions PostgreSQL 16, checks connectivity, resets the ephemeral test database, runs migrations, and then runs `bun run test:integration:files`.

## API auth flow

- Exchange long-lived API key for JWT: `POST /v1/auth/token` with `x-api-key`.
- Use access token for API calls: `Authorization: Bearer <jwt>`.
- See API contract: `apps/luxledger-api/openapi/openapi.yaml`.
