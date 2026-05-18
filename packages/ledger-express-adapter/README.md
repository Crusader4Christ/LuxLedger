# @lux/ledger-express-adapter

Express adapter for LuxLedger HTTP routes, aligned with `@lux/ledger-fastify-adapter`.

## Composition API

```ts
import express from 'express';
import { registerLedgerExpressAdapter } from '@lux/ledger-express-adapter';

const app = express();
registerLedgerExpressAdapter(app, {
  ledgerService,
  apiKeyService,
});
```

## Expected dependencies

- `ledgerService` (`LedgerService`)
- `apiKeyService` (`ApiKeyService`)

Both are from `@lux/ledger/application`.

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
  Adapter ensures JSON middleware exists for request body parsing.
