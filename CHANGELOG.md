# Changelog

LuxLedger uses coordinated releases: every public `@luxledger/*` package and
the OpenAPI contract share one version. Release details and migration guidance
are linked from each entry.

## [Unreleased]

## [0.5.0] - 2026-10-25

### Changed

- **Breaking:** `PaginationQuery` now takes a filter policy, for example `PaginationQuery<typeof assetListFilter>`, rather than a precomputed `WhereFor` type. Shared helpers accept `BasePaginationQuery`. Empty resource query aliases are removed; use `PaginationQuery<typeof policy>` directly.

- **Breaking:** ledger, API key, and reconciliation matching-rule list APIs now use bounded cursor pagination and return `{ data, next_cursor }`.
- Added paginated reconciliation run results at `/v1/reconciliation/runs/{id}/results`.
- Added policy-derived core list filters and typed HTTP `where` filters, with filter-bound cursors.
- Preserved PostgreSQL microseconds in timestamp cursors and accepted UUIDv7 path parameters.

Upgrade notes: library callers pass pagination query objects to `LedgerService.list`,
`AssetService.list`, `ApiKeyService.listApiKeys`, and `ReconciliationService.listRules`. HTTP callers
should read items from `data` and continue with `next_cursor`; `GET /v1/ledgers` changes from an
array response, while the API key and matching-rule envelopes gain `next_cursor`.

See [the 0.5.0 release notes](docs/releases/0.5.0.md).

## [0.4.0] - 2026-10-17

### Added

- Automated dry-run and provenance-enabled npm release workflow.
- Release, migration, deprecation, and idempotency governance documentation.
- Bounded cursor-paginated credit grant, lot, and allocation-lineage reads.
- Exact tenant-scoped grant recovery by reference and external reference.
- Ordered tenant-wide credit grant pagination index.

### Changed

- **Breaking:** `GET /v1/accounts/{id}/credit-balance` is summary-only. Read lots from
  `GET /v1/accounts/{id}/credit-lots`.
- **Breaking:** allocation-lineage responses use the common `{ data, next_cursor }` page shape
  instead of `{ allocations }`.
- **Breaking:** pagination cursors are versioned and scoped to the endpoint, tenant, and filters
  that created them; cursors from earlier releases are rejected.

See [the 0.4.0 release notes](docs/releases/0.4.0.md).

## [0.3.0] - 2026-10-16

- Adopted signed entry amounts and the current forward-only migration chain.
- Added credit grants, grant-aware reservations, and transaction metadata.
- Added coordinated package, contract, migration, and packed-install checks.

See [the 0.3.0 release notes](docs/releases/0.3.0.md).

## [0.2.1] - 2026-10-04

- Added coordinated release-readiness metadata and package verification.

See [the 0.2.1 release notes](docs/releases/0.2.1.md).

## [0.2.0] - 2026-10-03

- Published the initial public package set.

See [the 0.2.0 release notes](docs/releases/0.2.0.md).

[Unreleased]: https://github.com/Crusader4Christ/LuxLedger/tree/main
[0.4.0]: docs/releases/0.4.0.md
[0.3.0]: docs/releases/0.3.0.md
[0.2.1]: docs/releases/0.2.1.md
[0.2.0]: docs/releases/0.2.0.md
