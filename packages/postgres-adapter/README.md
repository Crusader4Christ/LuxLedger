# @luxledger/postgres-adapter

Drizzle/PostgreSQL adapter for `@luxledger/core`.

This package contains infrastructure implementations:

- `DrizzleLedgerRepository`
- Drizzle schema and row mappers
- PostgreSQL client factory
- `luxLedgerDrizzleSchemaPath` for consumer `drizzle.config.ts` files

It is intentionally tied to Drizzle and Postgres.

PostgreSQL 16 is the supported persistence model.

State-changing repository operations use explicit PostgreSQL transactions. The adapter enforces persistence-level tenant scoping, atomicity, and transaction-reference idempotency required by the repository [invariants guide](../../docs/product/invariants.md).

## Configuration

The client reads these package-owned variables when equivalent constructor options are not passed:

- `DATABASE_URL` (required)
- `DB_POOL_MAX` (default `10`)
- `DB_IDLE_TIMEOUT` in seconds (default `20`)
- `DB_CONNECT_TIMEOUT` in seconds (default `10`)

JWT, rate-limit, bootstrap, port, and shutdown configuration belongs to the host application, not this package. Environment files must be loaded by the host/runtime before `createDbClient` is called; Node.js does not load `.env` automatically.

## Drizzle config

```ts
import { luxLedgerDrizzleSchemaPath } from '@luxledger/postgres-adapter/drizzle-config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: ['./src/db/schema.ts', luxLedgerDrizzleSchemaPath],
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

Apply migrations before starting application code that depends on a newer adapter schema. Package downgrade does not roll back a database; follow the repository [upgrade procedure](../../docs/integration/versioning.md).

Before production use, pin compatible LuxLedger package versions and review the [documentation publication checklist](../../docs/integration/versioning.md#documentation-publication-checklist).
