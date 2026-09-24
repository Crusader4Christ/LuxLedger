# Credit grant lots (LL-84)

Credit grants are optional, immutable lot metadata layered over one account and its asset. They are not an account type and do not define an economic asset. Purchased credit, promotional credit, reward points, and similar distinctions belong in tenant assets and separate accounts when they have different accounting or spending semantics.

An account becomes grant-enabled when its first grant is issued. No `CREDIT_WALLET` kind or account mutation is involved. The account must use a registered asset, have `CREDIT` side and `DISALLOW` overdraft policy, and have no prior balance, entry, or hold history. A tenant may have any number of grant-enabled accounts, including accounts using different assets. Accounts with no grants remain ordinary accounts and their API and transaction payloads carry no grant fields.

`POST /v1/credit-grants` accepts only `ledger_id`, `account_id`, `funding_account_id`, `reference`, `amount_minor`, and optional `external_reference`. The grant asset is derived from `account.asset_id`; it is not duplicated in the request or grant table. The funding account must belong to the same tenant and ledger and use the same asset.

Every grant posts a balanced issuance transaction: the funding account is debited and the grant-enabled account is credited. The grant stores only its account scope, idempotency and external references, and issuance transaction linkage. The issuance entry is the authoritative granted amount. The grant row never stores an authoritative remaining or reversed balance.

The `(tenant_id, reference)` key is unique across all ledgers and accounts of a tenant. An identical retry returns the existing grant after comparing its tenant, ledger, account, complete immutable payload, and the amount derived from the issuance entry. Reusing the reference in another ledger or account produces an explicit scope conflict; another changed payload fails with `CREDIT_GRANT_CONFLICT`. The advisory lock is keyed by this exact tenant/reference pair, not by the whole tenant. An established grant-enabled account does not take an early account row lock; the explicit adoption lock and history checks run only when no grant exists, with a second grant lookup after locking. The posting update can still serialize concurrent writers of the same account balance projection. Grant creation, transaction posting, and entry linkage commit atomically under tenant RLS.

Entry-to-grant links are append-only financial lineage for the two operations implemented here: `ISSUANCE` and `REVERSAL`. The linked amount is immutable and derived balance calculation does not mutate grants. Composite foreign keys keep a link within one tenant, ledger, account, and grant, while database validation requires the linked entry asset to match the account asset.

`POST /v1/credit-grants/{id}/reversal` fully compensates a grant only while its derived capacity is untouched. It posts an opposite linked ledger transaction. Partial refunds and already-spent clawback policy remain LL-87.

`GET /v1/accounts/{id}/credit-balance` returns one `lot` per grant without taking an account row lock. Granted, reversed, remaining, and `ledger_balance_minor` are derived from immutable ledger entries, and the lot aggregate must reconcile with those entries. The mutable `accounts.balance_minor` projection is not an authority for this read and cache drift does not make grant history unreadable.

Generic transaction and hold contracts remain unchanged. A database boundary rejects unattributed entries or holds only after an account has grants, preventing its derived lot view from diverging while imposing no grant payload requirements on ordinary accounts.

Allocation, consumption policy, provenance metadata, and transfer/refund rules are intentionally deferred until a concrete product flow requires them. LL-66 owns deterministic allocation and consumption lineage. LL-85 owns expiration fields, entries, and eligibility enforcement. LL-67 and LL-89 may introduce organization ownership and spending authority around accounts, but LL-84 deliberately adds no user, organization, membership, or permission model.

Migration 0012 is unmerged and is rewritten in place. Disposable databases that applied an earlier PR preview must be reset before applying the revised migration.
