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
