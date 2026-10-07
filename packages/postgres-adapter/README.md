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

Transaction metadata is stored as nullable PostgreSQL `jsonb` on the immutable transaction header. Omitted metadata is SQL `NULL`, which remains distinct from an empty object. Idempotent retries use PostgreSQL `jsonb` equality: object key order is ignored, array order is significant, and any semantic metadata difference is a payload conflict.

## Host-composable unit of work

Use `createUnitOfWork` when a host row or outbox record must commit atomically with LuxLedger operations:

```ts
import { TenantId } from '@luxledger/core';
import { createDbClient, createUnitOfWork } from '@luxledger/postgres-adapter';
import { purchaseOutbox } from './db/schema';

const client = createDbClient({ hostSchema: { purchaseOutbox } });
const unitOfWork = createUnitOfWork(client);

await unitOfWork.run(new TenantId(tenantId), async ({ tx, services }) => {
  await tx.insert(purchaseOutbox).values({
    tenantId,
    purchaseId,
    eventType: 'purchase.created',
  });
  await services.transactions.create(posting);
});
```

The callback's Drizzle `tx` and tenant-scoped services share one transaction and RLS context. Register host tables through `hostSchema` to use the typed relational API such as `tx.query.purchaseOutbox`; use `tx.execute(sql\`...\`)` for raw parameterized SQL. A callback failure rolls back every write. Do not retain `tx` after the callback completes. Nested unit-of-work calls, cross-tenant service inputs, and unscoped service operations are rejected. Existing repository/service calls outside this API keep their current transaction behavior.

Hosts must preserve the documented account/grant lock order when doing their own locking before ledger calls. The unit of work does not retry transactions or provide distributed transaction/outbox delivery.

### Credit-grant allocation locking

Mutations that touch grant-enabled accounts lock those account rows in account-ID order before locking grants or writing ledger history. Ordinary accounts are not pre-locked; their balance projection is updated atomically in account-ID order, and PostgreSQL takes the row lock for the duration of that update and transaction. Holds read the immutable grant capability without a row lock and reject grant-enabled accounts. Grant issuance never converts an existing account or scans its history. Transaction posting groups inserted entries by account and processes accounts in account-ID order. For each grant-enabled account it performs one `SELECT ... FOR UPDATE` of the account's grants, ordered by `expires_at ASC NULLS LAST, created_at ASC, id ASC`. A grant-enabled account with debit entries loads one latest immutable capacity version per grant and updates that in-memory projection after every allocation so later entries in the same transaction observe earlier allocations. Each new lineage row appends its next cumulative version in the same transaction; versions are rebuildable from authoritative ledger entries and lineage and cannot be updated or deleted. Reversals load the original transaction lineage once per grant-enabled account and copy each original entry's exact grant split.

Grant locks remain held until the posting transaction commits or rolls back. Lineage rows, ledger entries, balance updates, and snapshots are written in that same transaction. The database constraints, row-level tenant policy, and deferred attribution and exact-compensation triggers remain the final boundary checks; there is no mutable authoritative grant-balance column.

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

Apply migrations before starting application code that depends on a newer adapter schema. Numbered migrations upgrade the consolidated `0000` baseline in place; reset databases created by the retired history that predates that baseline. Package downgrade does not roll back a database; follow the repository [upgrade procedure](../../docs/integration/versioning.md).

Before production use, pin compatible LuxLedger package versions and review the [documentation publication checklist](../../docs/integration/versioning.md#documentation-publication-checklist).
