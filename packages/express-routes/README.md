# @luxledger/express-routes

Express route registration package for LuxLedger HTTP routes, aligned with `@luxledger/fastify-routes`.

## Composition API

```ts
import express from 'express';
import { registerLedgerAdapter } from '@luxledger/express-routes';

const app = express();
registerLedgerAdapter(app, {
  ledgerService,
  apiKeyService,
});
```

## Expected dependencies

- `ledgerService` (`LedgerService`)
- `apiKeyService` (`ApiKeyService`)

Both are from `@luxledger/core/application`.

## Request context requirements

Routes require auth context to be pre-populated on the request:

- `tenantId`
- `apiKeyId`
- `apiKeyRole`

The hosting app must add auth middleware before adapter registration.

## Known framework differences and mitigations

- Validation:
  Express has no built-in JSON schema validation. The adapter applies explicit transport-level checks and maps failures to `400 INVALID_INPUT`.
- Error serialization:
  Express errors are translated through the same domain-error shape (`{ error, message }`) used by Fastify.
- Middleware ordering:
  Express host must register auth middleware before adapter routes. In Fastify, hook ordering provides this via `onRequest`.
- JSON parsing:
  Route registration ensures JSON middleware exists for request body parsing.

The complete and versioned route surface is defined by [`@luxledger/http` OpenAPI](../http/openapi/openapi.yaml). See the repository [integration guide](../../docs/integration/README.md) before composing the adapter in a host application.

Pin compatible LuxLedger package versions and verify the released OpenAPI before production; see [versioning and publication](../../docs/integration/versioning.md).
