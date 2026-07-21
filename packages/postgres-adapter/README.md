# @luxledger/postgres-adapter

Drizzle/PostgreSQL adapter for `@luxledger/core`.

This package contains infrastructure implementations:

- `DrizzleLedgerRepository`
- Drizzle schema and row mappers
- PostgreSQL client factory
- `luxLedgerDrizzleSchemaPath` for consumer `drizzle.config.ts` files

It is intentionally tied to Drizzle and Postgres.

State-changing repository operations use explicit PostgreSQL transactions. The adapter enforces persistence-level tenant scoping, atomicity, and transaction-reference idempotency required by the repository [invariants guide](../../docs/product/invariants.md).

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
