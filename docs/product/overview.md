# Product and Architecture Overview

LuxLedger is reusable financial-core infrastructure for tenant-isolated, double-entry ledgers. It supplies domain contracts, HTTP contracts, framework adapters, and PostgreSQL persistence; a host application owns deployment, authentication middleware, configuration, and lifecycle.

## Package boundaries

- `@luxledger/core` owns domain entities, invariants, application services, ports, and domain/application errors. It has no external runtime dependencies.
- `@luxledger/http` owns framework-neutral DTOs, error mapping, route contracts, and the canonical OpenAPI document.
- `@luxledger/fastify-routes` and `@luxledger/express-routes` bind those contracts to a host framework. They contain no ledger business rules.
- `@luxledger/postgres-adapter` implements application ports with Drizzle and PostgreSQL and owns transactional persistence behavior.
- Host applications compose services, authentication, rate limiting, observability, configuration, and process lifecycle.

The dependency direction is host application -> route and persistence adapters -> core/application contracts. Core never imports a host or adapter implementation.

## Implemented capabilities

The canonical surface is [`packages/http/openapi/openapi.yaml`](../../packages/http/openapi/openapi.yaml). It includes tenant ledgers and accounts, idempotent postings, atomic bulk posting, reversals and corrections, entries and trial balance, historical balances, funds holds, API-key administration, and baseline reconciliation.

## Request lifecycle

1. The host authenticates a request and supplies `tenantId`, `apiKeyId`, and `apiKeyRole` context.
2. A route adapter validates the transport contract and calls an application service.
3. Core/application code enforces business invariants.
4. The PostgreSQL adapter executes state changes inside an explicit transaction.
5. Domain/application failures are mapped to stable HTTP errors; database errors are never exposed.

For an executable composition, use the [reference demo](https://github.com/Crusader4Christ/LuxLedger-demo). The demo is illustrative, not a hosted LuxLedger service or a production deployment template.
