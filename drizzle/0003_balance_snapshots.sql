CREATE TYPE "balance_snapshot_event_type" AS ENUM(
  'TX_APPLIED',
  'HOLD_CREATED',
  'HOLD_COMMITTED',
  'HOLD_VOIDED',
  'ADJUSTMENT'
);

CREATE TABLE "balance_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE cascade,
  "ledger_id" uuid NOT NULL REFERENCES "ledgers"("id") ON DELETE restrict ON UPDATE cascade,
  "account_id" uuid NOT NULL REFERENCES "accounts"("id") ON DELETE restrict ON UPDATE cascade,
  "event_type" "balance_snapshot_event_type" NOT NULL,
  "source_id" uuid NOT NULL,
  "posted_minor" bigint NOT NULL,
  "inflight_debit_minor" bigint NOT NULL,
  "inflight_credit_minor" bigint NOT NULL,
  "effective_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "balance_snapshots_as_of_idx"
  ON "balance_snapshots"("tenant_id", "account_id", "effective_at");
CREATE INDEX "balance_snapshots_source_idx"
  ON "balance_snapshots"("tenant_id", "source_id", "event_type");
CREATE UNIQUE INDEX "balance_snapshots_dedup_uq"
  ON "balance_snapshots"("tenant_id", "event_type", "source_id", "account_id");
