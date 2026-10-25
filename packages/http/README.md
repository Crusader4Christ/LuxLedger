# @luxledger/http

HTTP mapping helpers for `@luxledger/core` domain/application errors.

## Boundaries

- Owns transport contracts and route-level reusable error response specs.
- Maps domain/application errors to transport-safe HTTP DTOs.
- Accepts the stable domain-error shape across bundled public export identities while rejecting raw database/unknown errors as non-leaking `500 INTERNAL_ERROR` responses.
- Contains no HTTP server runtime code and no persistence code.
- Reads no environment variables; JWT, rate limiting, port, and lifecycle configuration belong to the host application.

## Forbidden dependencies
- No framework runtime deps (for example: `fastify`, `express`, `nestjs`).
- No adapter/runtime deps (for example: `drizzle-orm`, `postgres`).
- Keep dependency direction: can depend on `@luxledger/core`, never on `apps/*`.

## Public API
- `@luxledger/http`:
  - `mapDomainErrorToHttp`
  - `errorResponseSchema`
  - `defaultErrorResponses`
  - `readWhereParameter`, typed list-filter field maps, and URL-encoded JSON schema helpers
  - `HttpErrorDto`, `HttpErrorMapper`, `ErrorResponse` types
- `@luxledger/http/errors`: schema and response contracts
- `@luxledger/http/errors`: error mapping
- `@luxledger/http/route-specs`: default route error response specs

## Usage

```ts
import { defaultErrorResponses, mapDomainErrorToHttp } from '@luxledger/http';

const dto = mapDomainErrorToHttp(error);
reply.code(dto.statusCode).send(dto);
route.schema.response = { ...defaultErrorResponses };
```

```ts
import { errorResponseSchema } from '@luxledger/http/errors';
```

## Canonical contract

The source-of-truth HTTP contract is [`openapi/openapi.yaml`](./openapi/openapi.yaml). Runtime contract definitions and OpenAPI must change together and pass `bun run contract:verify`. See the repository [integration guide](../../docs/integration/README.md) for host responsibilities and conventions.

The shared statement contracts cover `GET /v1/accounts/{id}/statement` and
`GET /v1/accounts/{id}/credit-statement`; both require explicit `from` and `as_of` boundaries and
use the common opaque cursor/limit contract.

Scoped list endpoints accept an optional `where` query parameter containing URL-encoded JSON.
For example, `?where=%7B%22balance_minor%22%3A%7B%22gte%22%3A%220%22%7D%7D` filters accounts
whose balance is at least zero. Filters are ANDed, use only each endpoint's documented public
fields, and support `eq`, `ne`, `in` plus numeric/date comparisons where applicable. The decoded
value is limited to 8 KiB; `in` accepts 1–100 non-null values. Omit `where` or pass `{}` for no
additional filter. Invalid JSON, repeated parameters, unknown fields/operators, and invalid types
return the shared `400 INVALID_INPUT` response.
Date-time filter values require a timezone and must be exactly representable in milliseconds.
Extra fractional digits are accepted only when zero (for example, `.123000Z`); values such as
`.123001Z` return `400 INVALID_INPUT` instead of silently changing the comparison boundary.

Before production use, cross-check this README against the OpenAPI shipped with the installed package version and review the [documentation publication checklist](../../docs/integration/versioning.md#documentation-publication-checklist).
