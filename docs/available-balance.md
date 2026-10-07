# Available balance and overdraft policy

Ledger amounts use one signed convention everywhere: a positive entry is a DEBIT and a negative entry is a CREDIT. Every balanced transaction and hold therefore has `sum(signed_amount_minor) = 0`.

`accounts.balance_minor` is the posted projection: the sum of committed signed entries for that account. It is normally positive for a DEBIT-normal account and negative for a CREDIT-normal account. The entries remain the accounting authority; the account field exists so availability checks do not replay the entire journal while holding a transaction lock.

`accounts.reserved_delta_minor` is the signed pending delta that consumes the account's natural balance. It deliberately ignores the capacity-increasing side of a hold, because incoming held funds must not become spendable before commit:

- DEBIT-normal account: only CREDIT hold legs reserve capacity, so `reserved_delta_minor <= 0`.
- CREDIT-normal account: only DEBIT hold legs reserve capacity, so `reserved_delta_minor >= 0`.

Availability is calculated as:

```text
signed_available_minor = balance_minor + reserved_delta_minor
available_minor = side == DEBIT
  ? signed_available_minor
  : -signed_available_minor
```

A `DISALLOW` account must have normalized `available_minor >= 0` after a successful reservation or posting. An `ALLOW` account may go below zero. `OVERDRAFT_POLICY_VIOLATION` (HTTP 409) reports the attempted normalized available amount.

Creating a hold changes only `reserved_delta_minor`. Committing it atomically adds the signed committed entries to `balance_minor` and removes their reservation delta. A partial commit retains the uncommitted reservation; void removes the remaining reservation. Failed operations roll back entries, account projections, snapshots, and hold state together. Idempotent retries do not apply any delta twice.

The account row is locked by the PostgreSQL update inside the explicit transaction. This serializes competing holds and postings. `balance_snapshots` copies both projections at event boundaries for historical reads; it is not a second mutable source of current balance.

Backdated postings update later balance snapshots for each affected account. There is currently no closed-period cutoff, so a very old posting may touch years of snapshots. A future period-closing feature should reject writes into closed periods and record corrections in an open period.
