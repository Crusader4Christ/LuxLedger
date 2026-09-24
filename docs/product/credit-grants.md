# Credit grant lots (LL-84)

Credit grants are optional, immutable lot metadata layered over one account and its asset. They are not an account type and do not define an economic asset. Purchased credit, promotional credit, reward points, and similar distinctions belong in tenant assets and separate accounts when they have different accounting or spending semantics.

An account becomes grant-enabled when its first grant is issued. No `CREDIT_WALLET` kind or account mutation is involved. The account must use a registered asset, have `CREDIT` side and `DISALLOW` overdraft policy, and have no prior balance, entry, or hold history. A tenant may have any number of grant-enabled accounts, including accounts using different assets. Accounts with no grants remain ordinary accounts and their API and transaction payloads carry no grant fields.

`POST /v1/credit-grants` accepts `ledger_id`, `account_id`, `funding_account_id`, `reference`, `provenance`, `amount_minor`, `policy`, and optional `external_reference` and `expires_at`. The grant asset is derived from `account.asset_id`; it is not duplicated in the request or grant table. The funding account must belong to the same tenant and ledger and use the same asset. `provenance` is opaque audit metadata such as `purchase`, `campaign:launch`, or `migration`; it does not select a balance bucket or imply policy.

Every grant posts a balanced issuance transaction: the funding account is debited and the grant-enabled account is credited. The grant stores immutable provenance, policy, optional expiration, external reference, and issuance transaction linkage. The issuance entry is the authoritative granted amount. The grant row never stores authoritative remaining, consumed, allocated, expired, or reversed balances.

The `(tenant_id, reference)` key is unique. An identical retry returns the existing grant after comparing the complete immutable payload and the amount derived from the issuance entry. A changed payload fails with `CREDIT_GRANT_CONFLICT`. Grant creation, transaction posting, and entry linkage commit atomically under tenant RLS.

Entry-to-grant links are append-only financial lineage. They contain a link kind and linked amount so one future debit entry can be attributed across multiple grants without mutating grant balances. LL-84 writes only `ISSUANCE` and `REVERSAL`; the schema reserves `ALLOCATION` and `EXPIRATION` for LL-66 and LL-85. Composite foreign keys keep a link within one tenant, ledger, account, and grant, while database validation requires the linked entry asset to match the account asset.

`POST /v1/credit-grants/{id}/reversal` fully compensates a grant only while its derived capacity is untouched. It posts an opposite linked ledger transaction. Partial refunds and already-spent clawback policy remain LL-87.

`GET /v1/accounts/{id}/credit-balance` returns one `lot` per grant. Lot amounts and `ledger_balance_minor` are derived from immutable ledger entries, and the lot aggregate must reconcile with those entries. The mutable `accounts.balance_minor` projection is not an authority for this read and cache drift does not make grant history unreadable. The response intentionally has no provenance totals: provenance is audit metadata, not an economic balance dimension. Until LL-66 and LL-85 add deduction writers, allocated, consumed, and expired derived amounts are zero.

Generic transaction and hold contracts remain unchanged. A database boundary rejects unattributed entries or holds only after an account has grants, preventing its derived lot view from diverging while imposing no grant payload requirements on ordinary accounts.

LL-66 will implement deterministic allocation and consumption lineage using the existing many-to-many entry links. LL-85 will post expiration entries and enforce synchronous eligibility and expiration checks. LL-67 and LL-89 may introduce organization ownership and spending authority around accounts, but LL-84 deliberately adds no user, organization, membership, or permission model.

Migration 0012 is unmerged and is rewritten in place. Disposable databases that applied an earlier PR preview must be reset before applying the revised migration.
