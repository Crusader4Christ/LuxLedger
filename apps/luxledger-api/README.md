# LuxLedger REST API (reference app)

Reference REST API built on top of `@lux/ledger`.

## Purpose

- Demonstrate how to compose `@lux/ledger` with Fastify + Drizzle.
- Keep application orchestration in `src/services` and HTTP transport in `src/api`.
- Keep HTTP and DB concerns outside the domain package.
- Provide a clean OpenAPI contract for integration.

## Planned runtime

- Bun
- Fastify
- Drizzle ORM
- PostgreSQL

## OpenAPI

API contract lives in:

- `apps/luxledger-api/openapi/openapi.yaml`

## Main endpoints

- `GET /health`, `GET /ready`
- `POST/GET /v1/ledgers`, `GET /v1/ledgers/:id`
- `POST/GET /v1/transactions`, `GET /v1/accounts`, `GET /v1/entries`
- `GET /v1/ledgers/:ledger_id/trial-balance`
- `GET/POST /v1/admin/api-keys`, `POST /v1/admin/api-keys/:id/revoke`
