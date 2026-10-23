# @luxledger/core Instructions

These rules extend the repository root instructions for `packages/core`.

## Ownership

- Own domain entities, value objects, invariants, domain errors, application services, repository
  ports, unit-of-work contracts, and persistence-neutral workflows.
- Keep repositories and application services focused by resource/responsibility. Do not introduce a
  new combined service or compatibility facade as the primary production API.
- Put shared primitives in `src/base`, application-facing contracts and orchestration in
  `src/application`, and bounded domain behavior in its named module.
- Keep repository interfaces expressed only in domain/application types. Never expose SQL, Drizzle,
  PostgreSQL rows, HTTP requests, or framework types.
- Prefer explicit inputs and injected collaborators such as `Clock`; domain decisions must remain
  deterministic and free of ambient state.

## Boundaries

- This package has zero external runtime dependencies.
- Do not import `@luxledger/http`, a route adapter, a persistence adapter, or host application code.
- Do not move an invariant to an adapter because it is convenient to enforce there. Adapters may add
  defense-in-depth constraints, but core remains the authoritative expression of business policy.
- Define transaction requirements through persistence-neutral ports. Concrete transaction, RLS, and
  locking mechanisms belong to adapters.
- Keep provider catalogs, permissions, authentication policy, and product-specific orchestration in
  the owning host rather than generalizing them into the ledger domain.

## Public API

- Preserve the module layout: `entity.ts`, `input.interface.ts`, `repository.interface.ts`, and
  `index.ts` where applicable.
- When adding a public symbol, update the appropriate module `index.ts`, root `src/index.ts` when
  needed, package exports/build entry points if a new subpath is introduced, and README examples.
- Avoid exporting implementation helpers unless they are intentionally supported contracts.

## Domain Guarantees

- Core emits domain/application errors only; transport and database failures do not belong here.
- Preserve explicit transaction requirements for state changes and balance projections, and
  idempotency semantics in addition to database uniqueness.

## Tests

- Test domain and application behavior without a database or framework.
- Do not mock the domain behavior under test. Use small in-memory port implementations when an
  application service needs a repository boundary.
- Cover every invariant with successful and failing cases, including idempotent retry versus payload
  conflict where relevant.
- Run the repository's code-change verification commands from the root.
