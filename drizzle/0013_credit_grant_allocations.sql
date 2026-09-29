ALTER TYPE "public"."credit_grant_entry_kind" ADD VALUE 'CONSUMPTION';--> statement-breakpoint
ALTER TYPE "public"."credit_grant_entry_kind" ADD VALUE 'COMPENSATION';--> statement-breakpoint
CREATE INDEX "credit_grant_entries_tenant_entry_idx" ON "credit_grant_entries" USING btree ("tenant_id","entry_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_credit_grant_entry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_transaction uuid;
DECLARE linked_transaction uuid;
DECLARE linked_direction entry_direction;
DECLARE linked_relation transaction_relation_type;
DECLARE related_transaction uuid;
DECLARE entry_amount bigint;
DECLARE issuance_amount bigint;
DECLARE available_amount bigint;
DECLARE source_allocation bigint;
DECLARE compensated_amount bigint;
DECLARE entry_asset uuid;
DECLARE transaction_asset uuid;
DECLARE account_asset uuid;
BEGIN
  PERFORM 1 FROM credit_grants
    WHERE id = NEW.grant_id AND tenant_id = NEW.tenant_id AND ledger_id = NEW.ledger_id
      AND account_id = NEW.account_id
    FOR UPDATE;
  SELECT transaction_id INTO source_transaction FROM credit_grants
    WHERE id = NEW.grant_id AND tenant_id = NEW.tenant_id AND ledger_id = NEW.ledger_id
      AND account_id = NEW.account_id;
  SELECT e.transaction_id, e.direction, t.relation_type, t.related_transaction_id,
         e.amount_minor, e.asset_id, t.asset_id, a.asset_id
    INTO linked_transaction, linked_direction, linked_relation, related_transaction,
         entry_amount, entry_asset, transaction_asset, account_asset
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

  SELECT
    coalesce(sum(CASE WHEN kind::text IN ('ISSUANCE', 'COMPENSATION') THEN amount_minor ELSE -amount_minor END), 0),
    coalesce(sum(CASE WHEN kind::text = 'ISSUANCE' THEN amount_minor ELSE 0 END), 0)
    INTO available_amount, issuance_amount
    FROM credit_grant_entries
    WHERE tenant_id = NEW.tenant_id AND grant_id = NEW.grant_id;

  IF NEW.kind::text = 'ISSUANCE' AND NOT (
    linked_transaction = source_transaction AND linked_direction = 'CREDIT'
    AND NEW.amount_minor = entry_amount
  ) THEN
    RAISE EXCEPTION 'credit grant issuance link is invalid';
  ELSIF NEW.kind::text = 'REVERSAL' AND NOT (
    linked_relation = 'REVERSAL' AND related_transaction = source_transaction
    AND linked_direction = 'DEBIT' AND NEW.amount_minor = entry_amount
    AND issuance_amount > 0 AND NEW.amount_minor = issuance_amount
    AND available_amount = issuance_amount
  ) THEN
    RAISE EXCEPTION 'credit grant reversal link is invalid';
  ELSIF NEW.kind::text = 'CONSUMPTION' THEN
    IF linked_direction <> 'DEBIT' OR NEW.amount_minor > available_amount THEN
      RAISE EXCEPTION 'credit grant consumption exceeds available capacity';
    END IF;
  ELSIF NEW.kind::text = 'COMPENSATION' THEN
    SELECT coalesce(sum(l.amount_minor), 0) INTO source_allocation
      FROM credit_grant_entries l
      JOIN entries e ON e.id = l.entry_id AND e.tenant_id = l.tenant_id
      WHERE l.tenant_id = NEW.tenant_id AND l.grant_id = NEW.grant_id
        AND l.kind::text = 'CONSUMPTION' AND e.transaction_id = related_transaction;
    SELECT coalesce(sum(l.amount_minor), 0) INTO compensated_amount
      FROM credit_grant_entries l
      JOIN entries e ON e.id = l.entry_id AND e.tenant_id = l.tenant_id
      WHERE l.tenant_id = NEW.tenant_id AND l.grant_id = NEW.grant_id
        AND l.kind::text = 'COMPENSATION' AND e.transaction_id = linked_transaction;
    IF linked_direction <> 'CREDIT' OR linked_relation <> 'REVERSAL'
      OR related_transaction IS NULL OR source_allocation = 0
      OR compensated_amount + NEW.amount_minor > source_allocation THEN
      RAISE EXCEPTION 'credit grant compensation does not match original allocation';
    END IF;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE FUNCTION assert_grant_compensation_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE linked_transaction uuid;
DECLARE related_transaction uuid;
DECLARE source_allocation bigint;
DECLARE compensated_amount bigint;
BEGIN
  IF NEW.kind::text <> 'COMPENSATION' THEN
    RETURN NEW;
  END IF;
  SELECT e.transaction_id, t.related_transaction_id
    INTO linked_transaction, related_transaction
    FROM entries e
    JOIN transactions t ON t.id = e.transaction_id AND t.tenant_id = e.tenant_id
    WHERE e.id = NEW.entry_id AND e.tenant_id = NEW.tenant_id;
  SELECT coalesce(sum(l.amount_minor), 0) INTO source_allocation
    FROM credit_grant_entries l
    JOIN entries e ON e.id = l.entry_id AND e.tenant_id = l.tenant_id
    WHERE l.tenant_id = NEW.tenant_id AND l.grant_id = NEW.grant_id
      AND l.kind::text = 'CONSUMPTION' AND e.transaction_id = related_transaction;
  SELECT coalesce(sum(l.amount_minor), 0) INTO compensated_amount
    FROM credit_grant_entries l
    JOIN entries e ON e.id = l.entry_id AND e.tenant_id = l.tenant_id
    WHERE l.tenant_id = NEW.tenant_id AND l.grant_id = NEW.grant_id
      AND l.kind::text = 'COMPENSATION' AND e.transaction_id = linked_transaction;
  IF source_allocation = 0 OR compensated_amount <> source_allocation THEN
    RAISE EXCEPTION 'credit grant compensation must exactly restore original allocation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER credit_grant_compensation_complete
  AFTER INSERT ON credit_grant_entries DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_grant_compensation_complete();--> statement-breakpoint
CREATE OR REPLACE FUNCTION assert_grant_entry_attributed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE attributed_amount bigint;
DECLARE linked_relation transaction_relation_type;
DECLARE related_transaction uuid;
DECLARE original_amount bigint;
DECLARE reversal_amount bigint;
BEGIN
  IF EXISTS (
    SELECT 1 FROM credit_grants
      WHERE tenant_id = NEW.tenant_id AND account_id = NEW.account_id
  ) THEN
    SELECT coalesce(sum(amount_minor), 0) INTO attributed_amount
      FROM credit_grant_entries
      WHERE tenant_id = NEW.tenant_id AND entry_id = NEW.id;
    IF attributed_amount <> NEW.amount_minor THEN
      RAISE EXCEPTION 'grant-enabled account entry requires complete grant attribution';
    END IF;
    SELECT relation_type, related_transaction_id INTO linked_relation, related_transaction
      FROM transactions WHERE id = NEW.transaction_id AND tenant_id = NEW.tenant_id;
    IF linked_relation::text = 'REVERSAL' THEN
      SELECT coalesce(sum(amount_minor), 0) INTO original_amount
        FROM entries
        WHERE tenant_id = NEW.tenant_id AND transaction_id = related_transaction
          AND account_id = NEW.account_id
          AND direction = CASE WHEN NEW.direction = 'CREDIT' THEN 'DEBIT'::entry_direction ELSE 'CREDIT'::entry_direction END;
      SELECT coalesce(sum(amount_minor), 0) INTO reversal_amount
        FROM entries
        WHERE tenant_id = NEW.tenant_id AND transaction_id = NEW.transaction_id
          AND account_id = NEW.account_id AND direction = NEW.direction;
      IF original_amount = 0 OR reversal_amount <> original_amount THEN
        RAISE EXCEPTION 'grant-enabled account reversal must exactly mirror original entries';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
