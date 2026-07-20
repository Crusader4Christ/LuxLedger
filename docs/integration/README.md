# Integration Guide

## Choose an integration boundary

- Use `@luxledger/fastify-routes` or `@luxledger/express-routes` when embedding the complete HTTP surface in an existing host.
- Use `@luxledger/core/application` with `@luxledger/postgres-adapter` when composing services without the supplied routes.
- Use `@luxledger/core` alone when implementing custom ports while preserving domain invariants.

## Host responsibilities

1. Provision PostgreSQL 16 and apply the migrations shipped by the adapter.
2. Create a database client and application services from `@luxledger/postgres-adapter`.
3. Authenticate requests before route registration and populate tenant/API-key context.
4. Register exactly one framework adapter.
5. Expose health, readiness, metrics, structured logs, and graceful shutdown appropriate to the deployment.
6. Keep all state-changing orchestration inside explicit transaction boundaries.

## Contract conventions

- Send money as integer `amount_minor` values plus an ISO-style currency code.
- Generate a unique stable transaction `reference`; retry the identical payload after timeouts.
- Treat a reference/payload mismatch as a client correctness error, not as a retryable conflict.
- Preserve `effective_at` separately from record creation time.
- Follow cursor pagination fields from the OpenAPI schemas rather than constructing cursors.
- Persist returned resource identifiers; do not derive IDs from names or references.

## Recommended first scenario

Create a ledger, create two same-currency accounts, post one balanced transaction, retry it with the same reference, list its entries, and verify the trial balance. The reference demo provides the runnable commands; the request and response schemas remain canonical in [`openapi.yaml`](../../packages/http/openapi/openapi.yaml).

Before production use, review [invariants](../product/invariants.md), [limitations](../product/limitations.md), [operations runbooks](../runbooks/operations-auth-mvp.md), and [versioning](./versioning.md).
