CREATE TABLE "credit_grant_hold_allocations" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ledger_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"grant_id" uuid NOT NULL,
	"hold_entry_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_grant_hold_allocations_amount_positive_chk" CHECK ("credit_grant_hold_allocations"."amount_minor" > 0)
);
--> statement-breakpoint
ALTER TABLE "credit_grant_hold_allocations" ADD CONSTRAINT "credit_grant_hold_allocations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hold_entries_tenant_account_id_uq" ON "hold_entries" USING btree ("tenant_id","account_id","id");--> statement-breakpoint
ALTER TABLE "credit_grant_hold_allocations" ADD CONSTRAINT "credit_grant_hold_allocations_grant_fk" FOREIGN KEY ("tenant_id","ledger_id","account_id","grant_id") REFERENCES "public"."credit_grants"("tenant_id","ledger_id","account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_grant_hold_allocations" ADD CONSTRAINT "credit_grant_hold_allocations_hold_entry_fk" FOREIGN KEY ("tenant_id","account_id","hold_entry_id") REFERENCES "public"."hold_entries"("tenant_id","account_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_grant_hold_allocations_grant_idx" ON "credit_grant_hold_allocations" USING btree ("tenant_id","grant_id");--> statement-breakpoint
CREATE INDEX "credit_grant_hold_allocations_hold_entry_idx" ON "credit_grant_hold_allocations" USING btree ("tenant_id","hold_entry_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_grant_hold_allocations_grant_hold_entry_uq" ON "credit_grant_hold_allocations" USING btree ("grant_id","hold_entry_id");--> statement-breakpoint
ALTER TABLE credit_grant_hold_allocations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE credit_grant_hold_allocations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY credit_grant_hold_allocations_tenant_rls ON credit_grant_hold_allocations
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
CREATE FUNCTION reject_credit_grant_hold_allocation_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'credit grant hold allocations are immutable';
END $$;--> statement-breakpoint
CREATE TRIGGER credit_grant_hold_allocations_immutable
  BEFORE UPDATE OR DELETE ON credit_grant_hold_allocations
  FOR EACH ROW EXECUTE FUNCTION reject_credit_grant_hold_allocation_change();--> statement-breakpoint
CREATE FUNCTION validate_credit_grant_hold_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE grant_expiration timestamptz;
DECLARE capacity bigint;
DECLARE reserved bigint;
DECLARE held_amount bigint;
DECLARE held_state hold_state;
BEGIN
  SELECT expires_at INTO grant_expiration
    FROM credit_grants
    WHERE tenant_id = NEW.tenant_id AND ledger_id = NEW.ledger_id
      AND account_id = NEW.account_id AND id = NEW.grant_id
    FOR UPDATE;
  SELECT he.signed_amount_minor, h.state INTO held_amount, held_state
    FROM hold_entries he
    JOIN holds h ON h.tenant_id = he.tenant_id AND h.id = he.hold_id
    WHERE he.tenant_id = NEW.tenant_id AND he.account_id = NEW.account_id
      AND he.id = NEW.hold_entry_id;
  IF held_amount IS NULL OR held_amount <= 0 OR held_state <> 'HELD'
    OR (grant_expiration IS NOT NULL AND grant_expiration <= transaction_timestamp()) THEN
    RAISE EXCEPTION 'credit grant hold allocation scope is invalid';
  END IF;
  SELECT remaining_minor INTO capacity
    FROM credit_grant_capacity_versions
    WHERE tenant_id = NEW.tenant_id AND grant_id = NEW.grant_id
    ORDER BY version DESC LIMIT 1;
  SELECT coalesce(sum(active.allocated - active.consumed), 0) INTO reserved
    FROM (
      SELECT h.id, sum(a.amount_minor) AS allocated,
        coalesce((
          SELECT sum(l.amount_minor)
          FROM credit_grant_entries l
          JOIN entries e ON e.id = l.entry_id AND e.tenant_id = l.tenant_id
          JOIN transactions t ON t.id = e.transaction_id AND t.tenant_id = e.tenant_id
          WHERE l.tenant_id = NEW.tenant_id AND l.grant_id = NEW.grant_id
            AND l.kind = 'CONSUMPTION' AND t.hold_id = h.id
        ), 0) AS consumed
      FROM credit_grant_hold_allocations a
      JOIN hold_entries he ON he.id = a.hold_entry_id AND he.tenant_id = a.tenant_id
      JOIN holds h ON h.id = he.hold_id AND h.tenant_id = he.tenant_id
      WHERE a.tenant_id = NEW.tenant_id AND a.grant_id = NEW.grant_id AND h.state = 'HELD'
      GROUP BY h.id
    ) active;
  IF coalesce(capacity, 0) - reserved < NEW.amount_minor THEN
    RAISE EXCEPTION 'credit grant hold allocation exceeds eligible capacity';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER credit_grant_hold_allocations_valid
  BEFORE INSERT ON credit_grant_hold_allocations
  FOR EACH ROW EXECUTE FUNCTION validate_credit_grant_hold_allocation();--> statement-breakpoint
DROP TRIGGER grant_account_holds_rejected ON hold_entries;--> statement-breakpoint
DROP FUNCTION reject_grant_account_hold();--> statement-breakpoint
CREATE FUNCTION assert_grant_hold_allocated() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allocated bigint;
BEGIN
  IF EXISTS (
    SELECT 1 FROM accounts
    WHERE tenant_id = NEW.tenant_id AND id = NEW.account_id AND grant_enabled
  ) THEN
    IF NEW.signed_amount_minor <= 0 THEN
      RAISE EXCEPTION 'grant-enabled account hold requires debit grant allocation';
    END IF;
    SELECT coalesce(sum(amount_minor), 0) INTO allocated
      FROM credit_grant_hold_allocations
      WHERE tenant_id = NEW.tenant_id AND hold_entry_id = NEW.id;
    IF allocated <> NEW.signed_amount_minor THEN
      RAISE EXCEPTION 'grant-enabled account hold requires complete grant allocation';
    END IF;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER grant_account_holds_allocated
  AFTER INSERT OR UPDATE ON hold_entries DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_grant_hold_allocated();--> statement-breakpoint
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

  IF NEW.kind::text IN ('REVERSAL', 'CONSUMPTION', 'EXPIRATION') THEN
    SELECT remaining_minor, granted_minor, consumed_minor, expired_minor
      INTO available_amount, issuance_amount, consumed_amount, expired_amount
      FROM credit_grant_capacity_versions
      WHERE tenant_id = NEW.tenant_id AND grant_id = NEW.grant_id
      ORDER BY version DESC LIMIT 1;
    available_amount := coalesce(available_amount, 0);
    issuance_amount := coalesce(issuance_amount, 0);
    consumed_amount := coalesce(consumed_amount, 0);
    expired_amount := coalesce(expired_amount, 0);
    SELECT coalesce(sum(active.allocated - active.consumed), 0) INTO reserved_amount
      FROM (
        SELECT h.id, sum(a.amount_minor) AS allocated,
          coalesce((
            SELECT sum(l.amount_minor)
            FROM credit_grant_entries l
            JOIN entries e ON e.id = l.entry_id AND e.tenant_id = l.tenant_id
            JOIN transactions t ON t.id = e.transaction_id AND t.tenant_id = e.tenant_id
            WHERE l.tenant_id = NEW.tenant_id AND l.grant_id = NEW.grant_id
              AND l.kind = 'CONSUMPTION' AND t.hold_id = h.id
          ), 0) AS consumed
        FROM credit_grant_hold_allocations a
        JOIN hold_entries he ON he.id = a.hold_entry_id AND he.tenant_id = a.tenant_id
        JOIN holds h ON h.id = he.hold_id AND h.tenant_id = he.tenant_id
        WHERE a.tenant_id = NEW.tenant_id AND a.grant_id = NEW.grant_id AND h.state = 'HELD'
        GROUP BY h.id
      ) active;
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
        RAISE EXCEPTION 'credit grant consumption exceeds reserved capacity';
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
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION assert_expired_grant_capacity_removed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE grant_expiration timestamptz;
DECLARE remaining_amount bigint;
DECLARE reserved_amount bigint;
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
    ORDER BY version DESC LIMIT 1;
  SELECT coalesce(sum(active.allocated - active.consumed), 0) INTO reserved_amount
    FROM (
      SELECT h.id, sum(a.amount_minor) AS allocated,
        coalesce((
          SELECT sum(l.amount_minor)
          FROM credit_grant_entries l
          JOIN entries e ON e.id = l.entry_id AND e.tenant_id = l.tenant_id
          JOIN transactions t ON t.id = e.transaction_id AND t.tenant_id = e.tenant_id
          WHERE l.tenant_id = NEW.tenant_id AND l.grant_id = NEW.grant_id
            AND l.kind = 'CONSUMPTION' AND t.hold_id = h.id
        ), 0) AS consumed
      FROM credit_grant_hold_allocations a
      JOIN hold_entries he ON he.id = a.hold_entry_id AND he.tenant_id = a.tenant_id
      JOIN holds h ON h.id = he.hold_id AND h.tenant_id = he.tenant_id
      WHERE a.tenant_id = NEW.tenant_id AND a.grant_id = NEW.grant_id AND h.state = 'HELD'
      GROUP BY h.id
    ) active;
  IF coalesce(remaining_amount, 0) <> reserved_amount THEN
    RAISE EXCEPTION 'expired credit grant cannot retain unreserved capacity';
  END IF;
  RETURN NEW;
END $$;
