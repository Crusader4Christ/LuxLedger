# @luxledger/fastify-routes Instructions

These rules extend the repository root instructions for `packages/fastify-routes`.

## Ownership and Boundaries

- Own only Fastify registration, Fastify request/reply adaptation, request-context typing, and
  framework-specific error/validation integration.
- Consume application services from `@luxledger/core/application` and shared contracts, schemas,
  mappers, pagination helpers, and error shapes from `@luxledger/http`.
- Do not implement business or persistence rules, construct repositories/services, access a database,
  read environment variables, or own authentication/JWT/rate-limit/server lifecycle behavior.
- The host must decorate and populate `tenantId`, `apiKeyId`, and `apiKeyRole` before these routes run.
- Production code must not import the Express adapter.

## Route Changes

- Keep route paths, status codes, validation, DTO serialization, and safe error responses aligned with
  the canonical OpenAPI and Express adapter.
- Prefer shared HTTP schemas and mappers over framework-local duplicates.
- Register new route families through `src/index.ts` and keep `registerLedgerAdapter` as the public
  composition entry point.
- Framework validation failures must use the documented transport error shape and must not leak
  internal errors.

## Verification

- Add focused Fastify injection tests for changed framework behavior.
- Run the root code-change checks, `bun run contract:verify` for contract changes, and the adapter
  parity suite with `bun test packages/express-routes/src/parity.test.ts` for shared route behavior.
  The shared parity test intentionally lives in the Express package and exercises both adapters.
