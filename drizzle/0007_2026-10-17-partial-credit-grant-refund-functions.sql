CREATE OR REPLACE FUNCTION append_credit_grant_capacity_version() RETURNS trigger LANGUAGE plpgsql AS $$
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
    ORDER BY version DESC LIMIT 1;

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
  ELSIF NEW.kind::text IN ('REVERSAL', 'REFUND') THEN
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
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_credit_grant_entry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_transaction uuid;
DECLARE grant_expiration timestamptz;
DECLARE funding_account uuid;
DECLARE linked_transaction uuid;
DECLARE linked_hold uuid;
DECLARE linked_signed_amount bigint;
DECLARE linked_relation transaction_relation_type;
DECLARE related_transaction uuid;
DECLARE linked_effective_at timestamptz;
DECLARE entry_amount bigint;
DECLARE issuance_amount bigint := 0;
DECLARE available_amount bigint := 0;
DECLARE consumed_amount bigint := 0;
DECLARE expired_amount bigint := 0;
DECLARE reserved_amount bigint := 0;
DECLARE hold_allocation bigint := 0;
DECLARE hold_consumed bigint := 0;
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
  SELECT e.transaction_id, t.hold_id, e.signed_amount_minor, t.relation_type,
         t.related_transaction_id, t.effective_at, abs(e.signed_amount_minor),
         e.asset_id, t.asset_id, a.asset_id
    INTO linked_transaction, linked_hold, linked_signed_amount, linked_relation,
         related_transaction, linked_effective_at, entry_amount,
         entry_asset, transaction_asset, account_asset
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

  IF NEW.kind::text IN ('REVERSAL', 'CONSUMPTION', 'EXPIRATION', 'REFUND') THEN
    SELECT remaining_minor, granted_minor, consumed_minor, expired_minor
      INTO available_amount, issuance_amount, consumed_amount, expired_amount
      FROM credit_grant_capacity_versions
      WHERE tenant_id = NEW.tenant_id AND grant_id = NEW.grant_id
      ORDER BY version DESC LIMIT 1;
    available_amount := coalesce(available_amount, 0);
    issuance_amount := coalesce(issuance_amount, 0);
    consumed_amount := coalesce(consumed_amount, 0);
    expired_amount := coalesce(expired_amount, 0);
    SELECT active_credit_grant_reservation(NEW.tenant_id, NEW.grant_id) INTO reserved_amount;
  END IF;

  IF NEW.kind::text = 'ISSUANCE' AND NOT (
    linked_transaction = source_transaction AND linked_signed_amount < 0
    AND NEW.amount_minor = entry_amount
    AND (grant_expiration IS NULL OR grant_expiration > transaction_timestamp())
  ) THEN
    RAISE EXCEPTION 'credit grant issuance link is invalid';
  ELSIF NEW.kind::text = 'REVERSAL' AND NOT (
    linked_relation = 'REVERSAL' AND related_transaction = source_transaction
    AND linked_signed_amount > 0 AND NEW.amount_minor = entry_amount
    AND issuance_amount > 0 AND NEW.amount_minor = issuance_amount
    AND available_amount = issuance_amount AND reserved_amount = 0
    AND consumed_amount = 0 AND expired_amount = 0
  ) THEN
    RAISE EXCEPTION 'credit grant reversal link is invalid';
  ELSIF NEW.kind::text = 'CONSUMPTION' THEN
    IF linked_hold IS NULL THEN
      IF linked_signed_amount <= 0 OR NEW.amount_minor > available_amount - reserved_amount
        OR (grant_expiration IS NOT NULL AND (
          grant_expiration <= linked_effective_at OR grant_expiration <= transaction_timestamp()
        )) THEN
        RAISE EXCEPTION 'credit grant consumption exceeds eligible capacity';
      END IF;
    ELSE
      SELECT coalesce(sum(a.amount_minor), 0) INTO hold_allocation
        FROM credit_grant_hold_allocations a
        JOIN hold_entries he ON he.id = a.hold_entry_id AND he.tenant_id = a.tenant_id
        JOIN holds h ON h.id = he.hold_id AND h.tenant_id = he.tenant_id
        WHERE a.tenant_id = NEW.tenant_id AND a.grant_id = NEW.grant_id
          AND h.id = linked_hold AND h.state = 'HELD';
      SELECT coalesce(sum(l.amount_minor), 0) INTO hold_consumed
        FROM credit_grant_entries l
        JOIN entries e ON e.id = l.entry_id AND e.tenant_id = l.tenant_id
        JOIN transactions t ON t.id = e.transaction_id AND t.tenant_id = e.tenant_id
        WHERE l.tenant_id = NEW.tenant_id AND l.grant_id = NEW.grant_id
          AND l.kind = 'CONSUMPTION' AND t.hold_id = linked_hold;
      IF linked_signed_amount <= 0 OR NEW.amount_minor > available_amount
        OR hold_consumed + NEW.amount_minor > hold_allocation THEN
        RAISE EXCEPTION 'credit grant consumption exceeds reserved capacity' USING ERRCODE = 'LL002';
      END IF;
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
    IF linked_signed_amount >= 0 OR linked_relation <> 'REVERSAL'
      OR related_transaction IS NULL OR source_allocation = 0
      OR compensated_amount + NEW.amount_minor > source_allocation THEN
      RAISE EXCEPTION 'credit grant compensation does not match original allocation';
    END IF;
  ELSIF NEW.kind::text = 'EXPIRATION' THEN
    SELECT coalesce(sum(-signed_amount_minor), 0) INTO funding_credit
      FROM entries
      WHERE tenant_id = NEW.tenant_id AND transaction_id = linked_transaction
        AND account_id = funding_account AND signed_amount_minor < 0;
    IF grant_expiration IS NULL OR grant_expiration > linked_effective_at
      OR grant_expiration > transaction_timestamp() OR linked_signed_amount <= 0
      OR NEW.amount_minor <> entry_amount OR NEW.amount_minor > available_amount - reserved_amount
      OR funding_credit <> NEW.amount_minor THEN
      RAISE EXCEPTION 'credit grant expiration link is invalid';
    END IF;
  ELSIF NEW.kind::text = 'REFUND' THEN
    SELECT coalesce(sum(-signed_amount_minor), 0) INTO funding_credit
      FROM entries
      WHERE tenant_id = NEW.tenant_id AND transaction_id = linked_transaction
        AND account_id = funding_account AND signed_amount_minor < 0;
    IF linked_hold IS NOT NULL OR linked_relation IS NOT NULL OR related_transaction IS NOT NULL
      OR linked_signed_amount <= 0 OR NEW.amount_minor <> entry_amount
      OR NEW.amount_minor > available_amount - reserved_amount
      OR (grant_expiration IS NOT NULL AND (
        grant_expiration <= linked_effective_at OR grant_expiration <= transaction_timestamp()
      )) OR funding_credit <> NEW.amount_minor THEN
      RAISE EXCEPTION 'credit grant refund link is invalid';
    END IF;
  END IF;
  RETURN NEW;
END $$;
