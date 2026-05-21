# App Composition Boundary

`apps/luxledger-api` is a composition root:
- server lifecycle and bootstrap
- env/config parsing
- infrastructure wiring (db/repository/services)
- auth/rate-limit/observability hooks
- adapter registration

HTTP route bindings and transport contracts are owned by adapter packages (`@lux/ledger-fastify-adapter`, `@lux/ledger-http`).

Contributor guardrail:
- Do not define request/response schemas or transport DTO types in `apps/luxledger-api`.
- Reuse `@lux/ledger-http/contracts` as the single source for transport contracts.
