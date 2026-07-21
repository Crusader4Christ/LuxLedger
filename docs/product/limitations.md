# Known Limitations

LuxLedger is a reusable component, not a managed accounting product.

- The packages do not provide a hosted control plane, UI, customer onboarding, or deployment automation.
- A host must supply authentication middleware, secret management, TLS, rate limiting, monitoring, and lifecycle management.
- PostgreSQL 16 is the supported persistence model; alternative databases are not implemented.
- Amounts are single-currency per transaction. Foreign-exchange pricing and realized/unrealized gain accounting are outside the current contract.
- Reconciliation is a baseline deterministic matcher, not a settlement network or exception-management UI.
- Reporting is limited to the documented ledger, entry, balance-history, and trial-balance surfaces.
- The demo demonstrates composition and API behavior; its in-process controls are not a production scaling or high-availability design.

Treat the canonical OpenAPI document and released package versions as the supported surface. Features absent from that contract must not be inferred from repository internals.
