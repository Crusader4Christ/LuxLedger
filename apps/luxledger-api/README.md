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

- `JWT_SIGNING_KEY` (required) — current HMAC signing key. Must be an unpadded base64url string representing at least 32 random bytes.
- `JWT_PREVIOUS_SIGNING_KEYS` (optional) — comma-separated previous HMAC keys accepted for verification only during a rotation grace window. Same format and minimum length as `JWT_SIGNING_KEY`.
- `JWT_ISSUER` (optional, default `luxledger-api`) — JWT issuer claim.
- `JWT_ACCESS_TTL_SECONDS` (optional, default `900`) — access token TTL in seconds, must be between `300` and `900`.
- `JWT_CLOCK_SKEW_SECONDS` (optional, default `5`) — allowed clock skew in seconds for `iat` and `exp`, must be between `0` and `60`.
- TTL policy: default to `900` seconds (15 minutes) to stay within the short-lived window while avoiding unnecessary token churn.
- Rotation policy: the API signs with `JWT_SIGNING_KEY` only and verifies with the current key first, then any keys listed in `JWT_PREVIOUS_SIGNING_KEYS`.
- Clock skew policy: a token is accepted only when `iat <= now + JWT_CLOCK_SKEW_SECONDS` and `exp > now - JWT_CLOCK_SKEW_SECONDS`.
- Revocation model: every bearer-authenticated request revalidates the underlying API key. A revoked key cannot mint new tokens, and any previously issued token is rejected immediately after revocation.
- Runbook: `docs/runbooks/jwt-key-rotation.md`.

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
