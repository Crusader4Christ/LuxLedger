# Baseline Reconciliation Runbook

Use baseline reconciliation to compare external provider records with posted LuxLedger transactions.

## Daily Workflow

1. Create or reuse a matching rule.

   Baseline reconciliation supports `one_to_one` matching. Start with deterministic criteria:

   - `reference` with `equals` or `contains`
   - `amount` with optional `amount_tolerance_minor`
   - `currency` with `equals`
   - `date` with optional `date_tolerance_seconds`

2. Ingest the provider records.

   Submit JSON records to `POST /v1/reconciliation/external-records`. Each record must include:

   - `id`: provider-side unique record id
   - `amount_minor`: positive integer string in minor units
   - `currency`
   - `reference`
   - `date`: ISO-8601 timestamp
   - optional `description` and `raw`

   Use a stable `source` value such as `stripe`, `bank-feed`, or `adyen`.

3. Run a dry-run first.

   Call `POST /v1/reconciliation/runs` with `dry_run: true`. Dry-run returns the same report shape as a committed run but does not persist run/results rows.

4. Review statuses.

   - `matched`: one external record matched exactly one internal transaction.
   - `unmatched_external`: no internal transaction matched the external record.
   - `unmatched_internal`: an internal transaction had no matched external record.
   - `mismatched`: reference matched, but another criterion failed.
   - `conflict`: multiple candidates matched; no arbitrary winner was selected.

5. Commit the run.

   Re-run with `dry_run: false` or omit `dry_run`. Save the returned run id for audit and follow-up.

6. Triage exceptions.

   Resolve `conflict` first because it blocks deterministic matching. Then investigate `mismatched`, followed by unmatched external/internal rows.

## Example Requests

Create a rule:

```json
{
  "name": "Bank feed baseline",
  "criteria": [
    { "field": "reference", "operator": "equals" },
    { "field": "amount", "operator": "equals", "amount_tolerance_minor": "0" },
    { "field": "currency", "operator": "equals" }
  ]
}
```

Ingest external records:

```json
{
  "source": "bank-feed",
  "records": [
    {
      "id": "bank-2026-01-01-0001",
      "amount_minor": "1000",
      "currency": "USD",
      "reference": "invoice-1001",
      "date": "2026-01-01T09:00:00.000Z"
    }
  ]
}
```

Run reconciliation:

```json
{
  "ledger_id": "018f0000-0000-7000-8000-000000000001",
  "upload_id": "018f0000-0000-7000-8000-000000000002",
  "strategy": "one_to_one",
  "matching_rule_ids": ["018f0000-0000-7000-8000-000000000003"],
  "dry_run": true
}
```

## Operating Rules

- Reconciliation never mutates ledger transactions.
- Committed runs persist immutable result rows for audit.
- Dry-runs do not persist run/results rows.
- Matching is deterministic: conflicts are reported explicitly instead of selecting a candidate by order.
- Re-uploading the same provider record id for the same source is rejected by `(tenant_id, source, external_id)` idempotency.
