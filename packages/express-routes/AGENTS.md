# @luxledger/express-routes Instructions

These rules extend the repository root instructions for `packages/express-routes`.

## Ownership and Boundaries

- Own only Express registration, middleware/request adaptation, request-context typing, and
  Express/Ajv-specific validation and error integration.
- Consume application services from `@luxledger/core/application` and shared contracts, schemas,
  mappers, pagination helpers, and error shapes from `@luxledger/http`.
- Do not implement business or persistence rules, construct repositories/services, access a database,
  read environment variables, or own authentication/JWT/rate-limit/server lifecycle behavior.
- The host must install authentication middleware that populates `tenantId`, `apiKeyId`, and
  `apiKeyRole` before adapter routes. JSON parsing must remain deterministic and correctly ordered.
- Production code must not import the Fastify adapter; parity tests may exercise both adapters.

## Route Changes

- Keep route paths, status codes, validation, DTO serialization, and safe error responses aligned with
  the canonical OpenAPI and Fastify adapter.
- Express has no built-in schema validation, so apply the shared HTTP schemas explicitly through the
  package validation layer. Do not silently accept input that the Fastify adapter rejects.
- Register new route families through `src/index.ts` and keep `registerLedgerAdapter` as the public
  composition entry point.
- Middleware and framework errors must use the documented transport error shape and must not leak
  internal errors.

## Verification

- Add focused Express request tests for changed middleware or validation behavior.
- Extend `src/parity.test.ts` whenever shared route behavior changes.
- Run the root code-change checks, `bun run contract:verify` for contract changes, and the adapter
  parity suite with `bun test packages/express-routes/src/parity.test.ts`.
