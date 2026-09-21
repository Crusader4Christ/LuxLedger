# ADR 0001: Tenant-scoped accounting assets

Status: accepted for the pre-production Credits SaaS baseline.

## Decision

Use an immutable `assets.id` as the accounting unit identity. An asset belongs to one tenant, has a tenant-unique uppercase `code`, and a scale from 0 through 18. `accounts`, `transactions`, `entries`, `holds`, and `hold_entries` each store a non-null `asset_id`. Amounts remain signed 64-bit integer minor units; this change never rescales an amount. One account holds one asset. A transaction or hold and every participating entry/account must use the same asset and ledger. There is no cross-asset posting or FX path.

| Option | Correctness | Compatibility | Migration cost | CREDIT, fiat, digital assets |
| --- | --- | --- | --- | --- |
| A. Keep only `currency` text | Code spelling is identity; no scale or tenant ownership | No API change | Cheap now, expensive after financial history exists | Weak: code/scale changes become ambiguous |
| B. Tenant assets and `asset_id` | Stable identity, scoped FKs, immutable code/scale | Existing currency requests continue for known codes | One additive backfill and validation migration | Fits CREDIT, EUR/USD, USDC and explicit future assets |
| C. Constrained text code with a scale registry | Scale is explicit, but account identity still changes in a later ID migration | Mostly compatible | Smaller now, repeats B later | Adequate until first rename or code collision |

B avoids a later rewrite of financial identity. `CREDIT` is one asset; promotional and purchased credit origins belong to grant/bucket records in LL-84, not distinct assets. Asset is an accounting unit, not a provider, wallet, user balance, custody object, or payment instrument.

## Compatibility and boundaries

`currency` remains required in published HTTP and application posting requests, and stays on all existing rows. It is an exact alias of the asset's immutable `code`; `asset_id` is the stable source of truth. A database guard resolves the code to an ID and rejects mismatches. The `AssetService` exposes tenant-scoped create, get, and list operations to host applications. The HTTP/OpenAPI surface does not change in this slice; the Credits SaaS host uses application services. Account creation can optionally pass `assetId` to assert the intended identity. Read entities carry `assetId` for persisted accounts, transactions, and entries. The optional/null constructor value keeps in-memory domain construction compatible.

`recon_records.currency` remains text because it describes an external uploaded record, not a posted ledger unit. Reconciliation still compares that code with the immutable transaction code.

Known legacy codes can be created on first use at CREDIT=0, EUR/USD=2, USDC=6 for compatibility with the published currency-only account API. New integrations should call `AssetService.create({ tenantId, code, scale })` first; that is the only way to register a new code or a non-default scale. Codes must match `^[A-Z][A-Z0-9_]{1,31}$`; the service normalizes surrounding whitespace and case, and code and scale are immutable after registration. Use a new asset for a different scale or meaning. No automatic `PROMO_CREDIT` asset is created.

Idempotency remains keyed by `(tenant_id, reference)` and compares the existing currency and entry payload. Because each code maps to exactly one immutable asset ID inside its tenant, an identical retry resolves to the same asset; a conflicting code or entry fails. Reversal/correction use the original code and therefore the original asset. Existing balance snapshots reference immutable accounts and need no second asset column.

## Migration and deployment

1. For a populated pre-production database, run the migration preflight. It aborts before changing schema when existing transaction/hold entries disagree with their account/parent, or when an unknown code lacks a reviewed scale mapping. Review and extend the mapping only after confirming what one stored minor unit means for that code.
2. Apply `0011_tenant_assets.sql` in one migration transaction. It creates tenant assets from distinct codes, backfills all five financial tables, verifies the links, then installs `NOT NULL`, tenant-scoped FKs, and write guards. It neither changes minor-unit values nor deletes history.
3. Deploy the updated packages after migration. Older package writes using known codes remain supported by the database resolver. For a fresh empty pre-production database, run all migrations and create CREDIT through `AssetService` before opening the SaaS tenant. There is no production data requiring a preservation window today.

Roll forward by repairing a failed preflight or scale mapping and rerunning the migration. Before activation, rollback is a test database reset. After activation, prefer a code rollback with this additive schema retained; removing asset columns would discard the new identity and is deliberately not provided as an automatic down migration.

Future multi-asset workflows need an explicit conversion model with rates, rounding, and separate balanced postings per asset. Grants, expiration and balance buckets remain LL-84; allocation and fund lineage remain LL-66.
