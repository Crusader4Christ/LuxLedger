ALTER TYPE "public"."credit_grant_entry_kind" ADD VALUE 'EXPIRATION';--> statement-breakpoint
ALTER TABLE "credit_grants" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "credit_grants_tenant_due_idx" ON "credit_grants" USING btree ("tenant_id","expires_at","created_at","id");--> statement-breakpoint
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
DECLARE issuance_amount bigint;
DECLARE available_amount bigint;
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
    SELECT
      coalesce(sum(CASE WHEN kind::text IN ('ISSUANCE', 'COMPENSATION') THEN amount_minor ELSE -amount_minor END), 0),
      coalesce(sum(CASE WHEN kind::text = 'ISSUANCE' THEN amount_minor ELSE 0 END), 0)
      INTO available_amount, issuance_amount
      FROM credit_grant_entries
      WHERE tenant_id = NEW.tenant_id AND grant_id = NEW.grant_id;
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
    AND NOT EXISTS (
      SELECT 1 FROM credit_grant_entries
      WHERE tenant_id = NEW.tenant_id AND grant_id = NEW.grant_id
        AND kind::text IN ('CONSUMPTION', 'EXPIRATION')
    )
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
CREATE FUNCTION assert_expired_grant_capacity_removed() RETURNS trigger LANGUAGE plpgsql AS $$
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
  SELECT coalesce(sum(CASE WHEN kind::text IN ('ISSUANCE', 'COMPENSATION')
    THEN amount_minor ELSE -amount_minor END), 0)
    INTO remaining_amount FROM credit_grant_entries
    WHERE tenant_id = NEW.tenant_id AND grant_id = NEW.grant_id;
  IF remaining_amount <> 0 THEN
    RAISE EXCEPTION 'expired credit grant cannot retain capacity';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER expired_grant_capacity_removed
  AFTER INSERT ON credit_grant_entries DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_expired_grant_capacity_removed();
