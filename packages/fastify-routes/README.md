# @luxledger/fastify-routes

Fastify route registration package for LuxLedger HTTP routes.

## Registering the adapter

```ts
import { registerLedgerAdapter } from '@luxledger/fastify-routes';

registerLedgerAdapter(server, {
  ledgerService,
  apiKeyService,
});
```

`server` must be a `FastifyInstance` that already has request auth context decorators used by the app (`tenantId`, `apiKeyId`, `apiKeyRole`).

## Expected dependencies

`registerLedgerAdapter` expects:

- `ledgerService` (`LedgerService`) for ledger/account/transaction/entry route handlers.
- `apiKeyService` (`ApiKeyService`) for admin API key route handlers.

Both are application services from `@luxledger/core/application`.

## Supported route families

The adapter registers these route families:

- `ledgers` (`/v1/ledgers`, trial balance, create transaction)
- `accounts` (`/v1/accounts`)
- `transactions` (`/v1/transactions`)
- `entries` (`/v1/entries`)
- `admin api keys` (`/v1/admin/api-keys`)

The complete and versioned route surface, including bulk posting, reversal/correction, historical balances, holds, and reconciliation, is defined by [`@luxledger/http` OpenAPI](../http/openapi/openapi.yaml). Hosts must register authentication before these routes and keep business logic in application services.

Pin compatible LuxLedger package versions and verify the released OpenAPI before production; see [versioning and publication](../../docs/integration/versioning.md).
