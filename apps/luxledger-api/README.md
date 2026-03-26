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

## Authentication

- `POST /v1/auth/token` accepts `x-api-key` and returns a short-lived JWT access token.
- All other `/v1/*` endpoints require `Authorization: Bearer <access_token>`.
- Admin endpoints (`/v1/admin/*`) require a token issued from an API key with `ADMIN` role.
- Revoked API keys cannot mint new access tokens, and any already-issued token is rejected on the next authenticated request.

## Auth environment variables

- `JWT_SIGNING_KEY` (required) — HMAC secret used to sign access tokens.
- `JWT_ISSUER` (optional, default `luxledger-api`) — JWT issuer claim.
- `JWT_ACCESS_TTL_SECONDS` (optional, default `900`) — access token TTL in seconds, must be between `300` and `900`.
- TTL policy: default to `900` seconds (15 minutes) to stay within the short-lived window while avoiding unnecessary token churn.
- Revocation model: every bearer-authenticated request revalidates the underlying API key. A revoked key cannot mint new tokens, and any previously issued token is rejected immediately after revocation.

## OpenAPI

API contract lives in:

- `apps/luxledger-api/openapi/openapi.yaml`
- Local raw spec endpoint: `GET /openapi.yaml`
- Local Swagger UI: `GET /docs`

## Main endpoints

- `GET /health`, `GET /ready`
- `POST/GET /v1/ledgers`, `GET /v1/ledgers/:id`
- `POST/GET /v1/transactions`, `GET /v1/accounts`, `GET /v1/entries`
- `GET /v1/ledgers/:ledger_id/trial-balance`
- `GET/POST /v1/admin/api-keys`, `POST /v1/admin/api-keys/:id/revoke`
