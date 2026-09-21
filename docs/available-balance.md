# Available balance and overdraft policy

Account balances are signed in minor units: a CREDIT entry adds to `balance_minor` and a DEBIT entry subtracts from it. The account's `side` describes its normal reporting side; it does not reverse the stored sign or the public `available_minor` calculation. This applies to both DEBIT and CREDIT accounts.

For each account, `available_minor = balance_minor - inflight_debit_minor + inflight_credit_minor`. A DISALLOW account must have `available_minor >= 0` after a successful hold reservation or posting. ALLOW accounts have no such restriction. The existing `OVERDRAFT_POLICY_VIOLATION` domain error (HTTP 409) reports the attempted available amount when the invariant fails.

Each operation sums only the debit and credit entries in that operation for an account before checking its final state. It does not replay prior transactions. The PostgreSQL account row update serializes competing holds and postings inside the existing tenant transaction. A hold commit moves its own reservation from in-flight to posted in the same transaction, leaving availability unchanged for the committed amount. A partial commit retains the uncommitted reservation; void releases what remains. Failed operations roll back entries, balances, snapshots, and hold state together. Idempotent retries return the existing result without applying balances again.

Backdated postings have a separate write cost: they update every later balance snapshot for each affected account. There is currently no closed-period cutoff, so a very old backdated posting can touch years of snapshots. A period-closing feature should reject postings with an `effective_at` in a closed period (with corrections recorded in an open period), making this work bounded by the open history.
