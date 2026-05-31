ALTER TABLE "accounts"
ADD COLUMN "inflight_debit_minor" bigint NOT NULL DEFAULT 0,
ADD COLUMN "inflight_credit_minor" bigint NOT NULL DEFAULT 0;

CREATE TYPE "hold_state" AS ENUM('HELD', 'APPLIED', 'VOIDED');

CREATE TABLE "holds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE cascade,
  "ledger_id" uuid NOT NULL REFERENCES "ledgers"("id") ON DELETE restrict ON UPDATE cascade,
  "reference" text NOT NULL,
  "currency" text NOT NULL,
  "description" text,
  "state" "hold_state" NOT NULL DEFAULT 'HELD',
  "original_amount_minor" bigint NOT NULL,
  "remaining_amount_minor" bigint NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "applied_at" timestamptz,
  "voided_at" timestamptz
);

CREATE UNIQUE INDEX "holds_tenant_reference_uq" ON "holds"("tenant_id", "reference");
CREATE INDEX "holds_ledger_id_idx" ON "holds"("ledger_id");

CREATE TABLE "hold_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE restrict ON UPDATE cascade,
  "hold_id" uuid NOT NULL REFERENCES "holds"("id") ON DELETE restrict ON UPDATE cascade,
  "account_id" uuid NOT NULL REFERENCES "accounts"("id") ON DELETE restrict ON UPDATE cascade,
  "direction" "entry_direction" NOT NULL,
  "amount_minor" bigint NOT NULL,
  "currency" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "hold_entries_tenant_id_idx" ON "hold_entries"("tenant_id");
CREATE INDEX "hold_entries_hold_id_idx" ON "hold_entries"("hold_id");
CREATE INDEX "hold_entries_account_id_idx" ON "hold_entries"("account_id");

ALTER TABLE "transactions"
ADD COLUMN "hold_id" uuid REFERENCES "holds"("id") ON DELETE restrict ON UPDATE cascade;

CREATE INDEX "transactions_hold_id_idx" ON "transactions"("hold_id");
