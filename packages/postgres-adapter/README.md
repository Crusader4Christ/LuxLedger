# @luxledger/postgres-adapter

Drizzle/PostgreSQL adapter for `@luxledger/core`.

This package contains infrastructure implementations:

- `DrizzleLedgerRepository`
- Drizzle schema and row mappers
- PostgreSQL client factory
- `luxLedgerDrizzleSchemaPath` for consumer `drizzle.config.ts` files

It is intentionally tied to Drizzle and Postgres.

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
