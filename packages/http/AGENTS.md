# @luxledger/http Instructions

These rules extend the repository root instructions for `packages/http`.

## Ownership

- `@luxledger/http` is the source of truth for transport contracts; framework adapters consume those
  contracts and must not redefine or fork them locally.
- Own framework-neutral request/response contracts, runtime schemas, DTO mappers, validation helpers,
  transport-safe error mapping, shared route primitives, and the canonical OpenAPI document at
  `openapi/openapi.yaml`.
- Convert domain/application results into transport DTOs here. Do not implement ledger decisions,
  persistence, authentication, authorization policy, rate limiting, or server lifecycle behavior.
- Unknown and database-originated failures must remain non-leaking internal errors. Only recognized
  domain/application errors may produce their documented client response.

## Boundaries

- Runtime code may depend on `@luxledger/core` only.
- Do not import Fastify, Express, NestJS, Drizzle, PostgreSQL clients, adapters, or host applications.
- Keep values such as `bigint`, dates, optional fields, and pagination cursors serialized consistently
  across both route adapters.

## Contract Changes

- Treat runtime schemas, TypeScript DTOs, mappers, error responses, and
  `openapi/openapi.yaml` as one versioned contract. Change them together.
- Derive TypeScript types from runtime schemas where practical; otherwise add compile-time or contract
  assertions that enforce exact type/schema compatibility. Preserve required, optional, and nullable
  semantics explicitly.
- A new or changed endpoint must be implementable by both route adapters without framework-specific
  semantics leaking into this package.
- Update `src/test/contract-suite.test.ts`, public API tests, and boundary guardrails when the governed
  surface or a public entry point changes.
- Shared pagination contracts must retain concrete item schemas, cursor opacity, default and maximum
  limits, and identical rejection behavior in both adapters.
- When adding a package subpath, update `package.json` exports, build entry points, and README usage.

## Tests and Verification

- Unit tests remain database-free; use core contracts without a persistence adapter.

- Run `bun run contract:verify` for every HTTP contract or OpenAPI change, in addition to the root
  code-change checks.
- Verify both success and error shapes, required/optional field behavior, and rejection of additional
  or malformed input where the contract specifies it.
