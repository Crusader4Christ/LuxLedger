# @lux/ledger

Domain-first ledger library for LuxLedger.

## Design goals

- Explicit invariants in domain classes/use-cases.
- Zero framework/runtime dependencies in core domain model.
- Stable contracts (`input.interface.ts` / `repository.interface.ts` / use-case result contracts).
- Deterministic behavior: same input -> same domain decision.

## Package structure

- `src/base`
  - Shared primitives and abstractions: `DomainError`, `Result`, `UnitOfWork`, `Clock`, `Id`, `Money`.
- `src/application`
  - App-facing contracts and error types for service/repository boundaries.
- `src/utils`
  - Shared helper utilities such as `assertNonEmpty`.
- `src/tenant`
  - Tenant model contracts.
- `src/ledger`
  - Ledger model contracts.
- `src/account`
  - Account model contracts.
- `src/transaction`
  - Transaction invariants and create transaction use-case.
- `src/entry`
  - Entry contracts.
- `src/api-key`
  - API key contracts.

## Conventions

Each domain module follows this layout:

- `entity.ts` - domain entity/value object.
- `input.interface.ts` - use-case input contracts.
- `repository.interface.ts` - persistence port contract.
- `index.ts` - module exports.

## Current executable domain logic

Today the executable business invariants are concentrated in `src/transaction`:

- `EntryEntity`
- `TransactionEntity`
- `CreateTransactionUseCase`

Other modules are contract-first and ready for incremental migration of business rules.

## Example

```ts
import { CreateTransactionUseCase } from '@lux/ledger';
import { assertNonEmpty } from '@lux/ledger/utils';

const useCase = new CreateTransactionUseCase(repository);
assertNonEmpty(input.tenantId, 'tenantId is required');
const result = await useCase.execute(command);
```

## Migration strategy

1. Keep API/DB adapters in the host app.
2. Move invariant checks into module use-cases.
3. Keep repository interfaces in `@lux/ledger`, implementations outside.
