CREATE TABLE "credit_grant_capacity_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ledger_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"grant_id" uuid NOT NULL,
	"source_entry_id" uuid,
	"version" bigint NOT NULL,
	"granted_minor" bigint NOT NULL,
	"reversed_minor" bigint NOT NULL,
	"consumed_minor" bigint NOT NULL,
	"compensated_minor" bigint NOT NULL,
	"expired_minor" bigint NOT NULL,
	"remaining_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_grant_capacity_versions_version_nonnegative_chk" CHECK ("credit_grant_capacity_versions"."version" >= 0),
	CONSTRAINT "credit_grant_capacity_versions_totals_nonnegative_chk" CHECK ("credit_grant_capacity_versions"."granted_minor" >= 0 and "credit_grant_capacity_versions"."reversed_minor" >= 0 and "credit_grant_capacity_versions"."consumed_minor" >= 0 and "credit_grant_capacity_versions"."compensated_minor" >= 0 and "credit_grant_capacity_versions"."expired_minor" >= 0 and "credit_grant_capacity_versions"."remaining_minor" >= 0),
	CONSTRAINT "credit_grant_capacity_versions_remaining_chk" CHECK ("credit_grant_capacity_versions"."remaining_minor" = "credit_grant_capacity_versions"."granted_minor" + "credit_grant_capacity_versions"."compensated_minor" - "credit_grant_capacity_versions"."reversed_minor" - "credit_grant_capacity_versions"."consumed_minor" - "credit_grant_capacity_versions"."expired_minor")
);
--> statement-breakpoint
ALTER TABLE "credit_grant_capacity_versions" ADD CONSTRAINT "credit_grant_capacity_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_grant_capacity_versions" ADD CONSTRAINT "credit_grant_capacity_versions_grant_fk" FOREIGN KEY ("tenant_id","ledger_id","account_id","grant_id") REFERENCES "public"."credit_grants"("tenant_id","ledger_id","account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_grant_capacity_versions" ADD CONSTRAINT "credit_grant_capacity_versions_source_entry_fk" FOREIGN KEY ("grant_id","source_entry_id") REFERENCES "public"."credit_grant_entries"("grant_id","entry_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_grant_capacity_versions_grant_version_uq" ON "credit_grant_capacity_versions" USING btree ("grant_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_grant_capacity_versions_source_entry_uq" ON "credit_grant_capacity_versions" USING btree ("grant_id","source_entry_id");--> statement-breakpoint
CREATE INDEX "credit_grant_capacity_versions_tenant_grant_version_idx" ON "credit_grant_capacity_versions" USING btree ("tenant_id","grant_id","version");--> statement-breakpoint
INSERT INTO credit_grant_capacity_versions (
  tenant_id, ledger_id, account_id, grant_id, source_entry_id, version,
  granted_minor, reversed_minor, consumed_minor, compensated_minor,
  expired_minor, remaining_minor
)
SELECT g.tenant_id, g.ledger_id, g.account_id, g.id, NULL, 0,
  coalesce(sum(l.amount_minor) FILTER (WHERE l.kind::text = 'ISSUANCE'), 0),
  coalesce(sum(l.amount_minor) FILTER (WHERE l.kind::text = 'REVERSAL'), 0),
  coalesce(sum(l.amount_minor) FILTER (WHERE l.kind::text = 'CONSUMPTION'), 0),
  coalesce(sum(l.amount_minor) FILTER (WHERE l.kind::text = 'COMPENSATION'), 0),
  coalesce(sum(l.amount_minor) FILTER (WHERE l.kind::text = 'EXPIRATION'), 0),
  coalesce(sum(CASE WHEN l.kind::text IN ('ISSUANCE', 'COMPENSATION')
    THEN l.amount_minor ELSE -l.amount_minor END), 0)
FROM credit_grants g
JOIN credit_grant_entries l ON l.tenant_id = g.tenant_id AND l.grant_id = g.id
GROUP BY g.tenant_id, g.ledger_id, g.account_id, g.id;--> statement-breakpoint
ALTER TABLE credit_grant_capacity_versions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE credit_grant_capacity_versions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY credit_grant_capacity_versions_tenant_rls ON credit_grant_capacity_versions
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE TRIGGER credit_grant_capacity_versions_immutable
  BEFORE UPDATE OR DELETE ON credit_grant_capacity_versions
  FOR EACH ROW EXECUTE FUNCTION reject_credit_grant_mutation();--> statement-breakpoint
CREATE FUNCTION reject_credit_grant_capacity_baseline_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source_entry_id IS NULL OR pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'credit grant capacity versions can only be appended from lineage';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER credit_grant_capacity_baseline_guard
  BEFORE INSERT ON credit_grant_capacity_versions
  FOR EACH ROW EXECUTE FUNCTION reject_credit_grant_capacity_baseline_insert();--> statement-breakpoint
CREATE FUNCTION append_credit_grant_capacity_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous_version bigint := 0;
DECLARE granted_amount bigint := 0;
DECLARE reversed_amount bigint := 0;
DECLARE consumed_amount bigint := 0;
DECLARE compensated_amount bigint := 0;
DECLARE expired_amount bigint := 0;
DECLARE remaining_amount bigint := 0;
BEGIN
  SELECT version, granted_minor, reversed_minor, consumed_minor, compensated_minor,
         expired_minor, remaining_minor
    INTO previous_version, granted_amount, reversed_amount, consumed_amount,
         compensated_amount, expired_amount, remaining_amount
    FROM credit_grant_capacity_versions
    WHERE tenant_id = NEW.tenant_id AND grant_id = NEW.grant_id
    ORDER BY version DESC
    LIMIT 1;

  previous_version := coalesce(previous_version, 0);
  granted_amount := coalesce(granted_amount, 0);
  reversed_amount := coalesce(reversed_amount, 0);
  consumed_amount := coalesce(consumed_amount, 0);
  compensated_amount := coalesce(compensated_amount, 0);
  expired_amount := coalesce(expired_amount, 0);
  remaining_amount := coalesce(remaining_amount, 0);

  IF NEW.kind::text = 'ISSUANCE' THEN
    granted_amount := granted_amount + NEW.amount_minor;
    remaining_amount := remaining_amount + NEW.amount_minor;
  ELSIF NEW.kind::text = 'REVERSAL' THEN
    reversed_amount := reversed_amount + NEW.amount_minor;
    remaining_amount := remaining_amount - NEW.amount_minor;
  ELSIF NEW.kind::text = 'CONSUMPTION' THEN
    consumed_amount := consumed_amount + NEW.amount_minor;
    remaining_amount := remaining_amount - NEW.amount_minor;
  ELSIF NEW.kind::text = 'COMPENSATION' THEN
    compensated_amount := compensated_amount + NEW.amount_minor;
    remaining_amount := remaining_amount + NEW.amount_minor;
  ELSIF NEW.kind::text = 'EXPIRATION' THEN
    expired_amount := expired_amount + NEW.amount_minor;
    remaining_amount := remaining_amount - NEW.amount_minor;
  ELSE
    RAISE EXCEPTION 'unsupported credit grant capacity transition';
  END IF;

  INSERT INTO credit_grant_capacity_versions (
    tenant_id, ledger_id, account_id, grant_id, source_entry_id, version,
    granted_minor, reversed_minor, consumed_minor, compensated_minor,
    expired_minor, remaining_minor
  ) VALUES (
    NEW.tenant_id, NEW.ledger_id, NEW.account_id, NEW.grant_id, NEW.entry_id,
    previous_version + 1, granted_amount, reversed_amount, consumed_amount,
    compensated_amount, expired_amount, remaining_amount
  );
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER credit_grant_capacity_version_appended
  AFTER INSERT ON credit_grant_entries
  FOR EACH ROW EXECUTE FUNCTION append_credit_grant_capacity_version();--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_credit_grant_entry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_transaction uuid;
DECLARE grant_expiration timestamptz;
DECLARE funding_account uuid;
DECLARE linked_transaction uuid;
DECLARE linked_direction entry_direction;
DECLARE linked_relation transaction_relation_type;
DECLARE related_transaction uuid;
DECLARE linked_effective_at timestamptz;
DECLARE entry_amount bigint;
DECLARE issuance_amount bigint := 0;
DECLARE available_amount bigint := 0;
DECLARE consumed_amount bigint := 0;
DECLARE expired_amount bigint := 0;
DECLARE source_allocation bigint;
DECLARE compensated_amount bigint;
DECLARE entry_asset uuid;
DECLARE transaction_asset uuid;
DECLARE account_asset uuid;
DECLARE funding_credit bigint;
BEGIN
  SELECT transaction_id, expires_at, funding_account_id
    INTO source_transaction, grant_expiration, funding_account
    FROM credit_grants
    WHERE id = NEW.grant_id AND tenant_id = NEW.tenant_id AND ledger_id = NEW.ledger_id
      AND account_id = NEW.account_id
    FOR UPDATE;
  SELECT e.transaction_id, e.direction, t.relation_type, t.related_transaction_id,
         t.effective_at, e.amount_minor, e.asset_id, t.asset_id, a.asset_id
    INTO linked_transaction, linked_direction, linked_relation, related_transaction,
         linked_effective_at, entry_amount, entry_asset, transaction_asset, account_asset
    FROM entries e
    JOIN transactions t ON t.id = e.transaction_id
      AND t.tenant_id = NEW.tenant_id AND t.ledger_id = NEW.ledger_id
    JOIN accounts a ON a.id = e.account_id
      AND a.tenant_id = NEW.tenant_id AND a.ledger_id = NEW.ledger_id
    WHERE e.id = NEW.entry_id AND e.tenant_id = NEW.tenant_id
      AND e.account_id = NEW.account_id;
  IF source_transaction IS NULL OR linked_transaction IS NULL
    OR entry_asset <> account_asset OR transaction_asset <> account_asset
    OR NEW.amount_minor > entry_amount THEN
    RAISE EXCEPTION 'credit grant entry scope or amount mismatch';
  END IF;

  IF NEW.kind::text IN ('REVERSAL', 'CONSUMPTION', 'EXPIRATION') THEN
    SELECT remaining_minor, granted_minor, consumed_minor, expired_minor
      INTO available_amount, issuance_amount, consumed_amount, expired_amount
      FROM credit_grant_capacity_versions
      WHERE tenant_id = NEW.tenant_id AND grant_id = NEW.grant_id
      ORDER BY version DESC
      LIMIT 1;
    available_amount := coalesce(available_amount, 0);
    issuance_amount := coalesce(issuance_amount, 0);
    consumed_amount := coalesce(consumed_amount, 0);
    expired_amount := coalesce(expired_amount, 0);
  END IF;

  IF NEW.kind::text = 'ISSUANCE' AND NOT (
    linked_transaction = source_transaction AND linked_direction = 'CREDIT'
    AND NEW.amount_minor = entry_amount
    AND (grant_expiration IS NULL OR grant_expiration > transaction_timestamp())
  ) THEN
    RAISE EXCEPTION 'credit grant issuance link is invalid';
  ELSIF NEW.kind::text = 'REVERSAL' AND NOT (
    linked_relation = 'REVERSAL' AND related_transaction = source_transaction
    AND linked_direction = 'DEBIT' AND NEW.amount_minor = entry_amount
    AND issuance_amount > 0 AND NEW.amount_minor = issuance_amount
    AND available_amount = issuance_amount
    AND consumed_amount = 0 AND expired_amount = 0
  ) THEN
    RAISE EXCEPTION 'credit grant reversal link is invalid';
  ELSIF NEW.kind::text = 'CONSUMPTION' THEN
    IF linked_direction <> 'DEBIT' OR NEW.amount_minor > available_amount
      OR (grant_expiration IS NOT NULL AND (
        grant_expiration <= linked_effective_at OR grant_expiration <= transaction_timestamp()
      )) THEN
      RAISE EXCEPTION 'credit grant consumption exceeds eligible capacity';
    END IF;
  ELSIF NEW.kind::text = 'COMPENSATION' THEN
    SELECT
      coalesce(sum(l.amount_minor) FILTER (
        WHERE l.kind::text = 'CONSUMPTION' AND e.transaction_id = related_transaction
      ), 0),
      coalesce(sum(l.amount_minor) FILTER (
        WHERE l.kind::text = 'COMPENSATION' AND e.transaction_id = linked_transaction
      ), 0)
      INTO source_allocation, compensated_amount
      FROM credit_grant_entries l
      JOIN entries e ON e.id = l.entry_id AND e.tenant_id = l.tenant_id
      WHERE l.tenant_id = NEW.tenant_id AND l.grant_id = NEW.grant_id;
    IF linked_direction <> 'CREDIT' OR linked_relation <> 'REVERSAL'
      OR related_transaction IS NULL OR source_allocation = 0
      OR compensated_amount + NEW.amount_minor > source_allocation THEN
      RAISE EXCEPTION 'credit grant compensation does not match original allocation';
    END IF;
  ELSIF NEW.kind::text = 'EXPIRATION' THEN
    SELECT coalesce(sum(amount_minor), 0) INTO funding_credit
      FROM entries
      WHERE tenant_id = NEW.tenant_id AND transaction_id = linked_transaction
        AND account_id = funding_account AND direction = 'CREDIT';
    IF grant_expiration IS NULL OR grant_expiration > linked_effective_at
      OR grant_expiration > transaction_timestamp() OR linked_direction <> 'DEBIT'
      OR NEW.amount_minor <> entry_amount OR NEW.amount_minor > available_amount
      OR funding_credit <> NEW.amount_minor THEN
      RAISE EXCEPTION 'credit grant expiration link is invalid';
    END IF;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION assert_expired_grant_capacity_removed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE grant_expiration timestamptz;
DECLARE remaining_amount bigint;
BEGIN
  IF NEW.kind::text NOT IN ('COMPENSATION', 'EXPIRATION') THEN
    RETURN NEW;
  END IF;
  SELECT expires_at INTO grant_expiration FROM credit_grants
    WHERE tenant_id = NEW.tenant_id AND id = NEW.grant_id;
  IF grant_expiration IS NULL OR grant_expiration > transaction_timestamp() THEN
    RETURN NEW;
  END IF;
  SELECT remaining_minor INTO remaining_amount
    FROM credit_grant_capacity_versions
    WHERE tenant_id = NEW.tenant_id AND grant_id = NEW.grant_id
    ORDER BY version DESC
    LIMIT 1;
  IF coalesce(remaining_amount, 0) <> 0 THEN
    RAISE EXCEPTION 'expired credit grant cannot retain capacity';
  END IF;
  RETURN NEW;
END $$;
