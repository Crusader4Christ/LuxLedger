# Available balance and overdraft policy

Account balances are signed in minor units: a CREDIT entry adds to `balance_minor` and a DEBIT entry subtracts from it. The account's `side` describes its normal reporting side; it does not reverse the stored sign or the public `available_minor` calculation. This applies to both DEBIT and CREDIT accounts.

For each account, `available_minor = balance_minor - inflight_debit_minor + inflight_credit_minor`. A DISALLOW account must have `available_minor >= 0` after a successful hold reservation or posting. ALLOW accounts have no such restriction. The existing `OVERDRAFT_POLICY_VIOLATION` domain error (HTTP 409) reports the attempted available amount when the invariant fails.

Each operation sums all debit and credit entries for an account before checking its final state. The PostgreSQL account row update serializes competing holds and postings inside the existing tenant transaction. A hold commit moves its own reservation from in-flight to posted in the same transaction, leaving availability unchanged for the committed amount. A partial commit retains the uncommitted reservation; void releases what remains. Failed operations roll back entries, balances, snapshots, and hold state together. Idempotent retries return the existing result without applying balances again.
