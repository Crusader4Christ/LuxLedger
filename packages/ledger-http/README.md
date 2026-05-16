# @lux/ledger-http

HTTP mapping helpers for `@lux/ledger` domain/application errors.

## Boundaries
- Owns transport contracts and route-level reusable error response specs.
- Maps domain/application errors to transport-safe HTTP DTOs.
- Contains no HTTP server runtime code and no persistence code.

## Forbidden dependencies
- No framework runtime deps (for example: `fastify`, `express`, `nestjs`).
- No adapter/runtime deps (for example: `drizzle-orm`, `postgres`).
- Keep dependency direction: can depend on `@lux/ledger`, never on `apps/*`.

## Public API
- `@lux/ledger-http`:
  - `mapDomainErrorToHttp`
  - `errorResponseSchema`
  - `defaultErrorResponses`
  - `HttpErrorDto`, `HttpErrorMapper`, `ErrorResponse` types
- `@lux/ledger-http/contracts`: schema and response contracts
- `@lux/ledger-http/errors`: error mapping
- `@lux/ledger-http/route-specs`: default route error response specs

## Internal
- `src/internal.ts` is internal-only and must not be exported from package root.

## Usage

```ts
import { defaultErrorResponses, mapDomainErrorToHttp } from '@lux/ledger-http';

const dto = mapDomainErrorToHttp(error);
reply.code(dto.statusCode).send(dto);
route.schema.response = { ...defaultErrorResponses };
```

```ts
import { errorResponseSchema } from '@lux/ledger-http/contracts';
```
