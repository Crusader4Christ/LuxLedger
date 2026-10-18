# @luxledger/postgres-adapter Instructions

These rules extend the repository root instructions for `packages/postgres-adapter` and describe the
target package boundary. The current package contains broader application and policy code that should
be extracted over time; its current location is not architectural precedent.

## Narrow Target Boundary

Keep code here only when it is specifically required to implement LuxLedger persistence with
PostgreSQL and Drizzle:

- PostgreSQL client/session setup and pool configuration;
- concrete SQL transaction and tenant/RLS context handling;
- Drizzle schema definitions, focused PostgreSQL repository implementations, queries, and row mappers;
- PostgreSQL locking primitives, isolation behavior, SQLSTATE/constraint interpretation, and
  database-error translation;
- PostgreSQL-specific unit-of-work implementation and migration/integration support.

Use this placement test before adding or expanding code: **would the code still be needed with a
different database implementation?** If yes, it does not belong here. Put domain rules and reusable
policy in `@luxledger/core`, persistence-neutral application orchestration behind core ports, HTTP
behavior in `@luxledger/http`, and host composition in the host or a dedicated composition package.

Do not add any new reusable application policy or orchestration that would remain useful with another
persistence backend. This includes generic application-service composition, posting policy, grant
allocation policy, reconciliation policy, validation rules, cursor semantics, and reusable workflow
logic. Existing misplaced code may remain only until an explicitly scoped extraction task moves it;
its presence never permits adding adjacent policy. Unless the current task explicitly includes
boundary cleanup, avoid expanding that code and record the extraction as follow-up work instead of
performing an incidental refactor.

## Dependency and Error Boundaries

- Production code may depend on `@luxledger/core` and PostgreSQL/Drizzle implementation libraries.
  It must not import `@luxledger/http`, framework route packages, or host application code.
- Implement core repository and unit-of-work ports; do not redefine their business contracts locally.
- Keep repository implementations separated by resource/responsibility. Do not recreate a monolithic
  repository or compatibility facade as the primary production API.
- Preserve domain/application errors. Translate constraint and database failures to stable
  domain/application errors and never expose SQL text, constraint detail, connection data, or raw
  driver errors to callers.
- Do not export internal query helpers or row types as public API unless integrators intentionally need
  them.

## Transactions, Tenancy, and Concurrency

- Every state-changing operation runs in an explicit transaction.
- Tenant-scoped work must set the PostgreSQL tenant context inside the same transaction before any
  tenant-owned query. Never execute tenant-owned operations through an unscoped client.
- Keep multi-row mutations, idempotency decisions, ledger entries, balance projections, snapshots,
  and associated lineage atomic.
- Follow the documented deterministic account/grant lock order. Changes to locking require real
  concurrent integration coverage and must not weaken correctness to improve throughput.
- Database constraints and RLS are defense in depth; mirror business invariants in core rather than
  making PostgreSQL their only definition.

## Schema and Migrations

- Edit `src/schema.ts`, then generate migrations from the repository root with
  `bun run db:generate`. Never hand-edit files under `drizzle/`.
- Inspect generated SQL for tenant-safe keys, foreign keys, indexes, constraints, lock implications,
  and upgrade safety. Update schema documentation when field semantics change.
- A schema change requires migration coverage and the real PostgreSQL integration suite.

## Tests

- Unit-test isolated parsing and error-translation helpers where useful.
- Repository, transaction, RLS, locking, migration, and rollback behavior must be tested against the
  real PostgreSQL 16 test database.
- Include tenant-isolation and failure/rollback cases for state-changing behavior. Add concurrency and
  idempotency-conflict cases when ordering or uniqueness is involved.
- Run the root code-change checks plus `bun run test:integration` for persistence changes.
