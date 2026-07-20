# @luxledger/http

HTTP mapping helpers for `@luxledger/core` domain/application errors.

## Boundaries

- Owns transport contracts and route-level reusable error response specs.
- Maps domain/application errors to transport-safe HTTP DTOs.
- Contains no HTTP server runtime code and no persistence code.

## Forbidden dependencies
- No framework runtime deps (for example: `fastify`, `express`, `nestjs`).
- No adapter/runtime deps (for example: `drizzle-orm`, `postgres`).
- Keep dependency direction: can depend on `@luxledger/core`, never on `apps/*`.

## Public API
- `@luxledger/http`:
  - `mapDomainErrorToHttp`
  - `errorResponseSchema`
  - `defaultErrorResponses`
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
