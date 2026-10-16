ALTER TABLE "holds" ADD CONSTRAINT "holds_amounts_chk" CHECK ("holds"."original_amount_minor" > 0 and "holds"."remaining_amount_minor" >= 0 and "holds"."remaining_amount_minor" <= "holds"."original_amount_minor");--> statement-breakpoint
ALTER TABLE "holds" ADD CONSTRAINT "holds_state_amount_chk" CHECK (("holds"."state" = 'HELD' and "holds"."remaining_amount_minor" > 0) or ("holds"."state" in ('APPLIED', 'VOIDED') and "holds"."remaining_amount_minor" = 0));
--> statement-breakpoint
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
ALTER TABLE "credit_grant_capacity_versions" ADD COLUMN "source_allocation_id" uuid;--> statement-breakpoint
ALTER TABLE "credit_grant_capacity_versions" ADD COLUMN "source_hold_id" uuid;--> statement-breakpoint
ALTER TABLE "credit_grant_capacity_versions" ADD COLUMN "reserved_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_grant_capacity_versions" ADD CONSTRAINT "credit_grant_capacity_versions_source_allocation_id_credit_grant_hold_allocations_id_fk" FOREIGN KEY ("source_allocation_id") REFERENCES "public"."credit_grant_hold_allocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_grant_capacity_versions" ADD CONSTRAINT "credit_grant_capacity_versions_source_hold_id_holds_id_fk" FOREIGN KEY ("source_hold_id") REFERENCES "public"."holds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_grant_capacity_versions_source_allocation_uq" ON "credit_grant_capacity_versions" USING btree ("source_allocation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_grant_capacity_versions_source_hold_uq" ON "credit_grant_capacity_versions" USING btree ("grant_id","source_hold_id");--> statement-breakpoint
ALTER TABLE "credit_grant_capacity_versions" ADD CONSTRAINT "credit_grant_capacity_versions_reserved_chk" CHECK ("credit_grant_capacity_versions"."reserved_minor" >= 0 and "credit_grant_capacity_versions"."reserved_minor" <= "credit_grant_capacity_versions"."remaining_minor");--> statement-breakpoint
-- Reads use the latest reservation snapshot. VOLATILE preserves visibility
-- of snapshots appended by earlier rows in the same statement.
CREATE FUNCTION active_credit_grant_reservation(p_tenant uuid, p_grant uuid)
RETURNS numeric LANGUAGE sql VOLATILE SECURITY INVOKER AS $$
  SELECT coalesce((SELECT reserved_minor FROM credit_grant_capacity_versions
    WHERE tenant_id = p_tenant AND grant_id = p_grant ORDER BY version DESC LIMIT 1), 0)::numeric;
$$;--> statement-breakpoint

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
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid tenant-scoped allocation relationship' USING ERRCODE = 'LL003';
  END IF;
  SELECT he.signed_amount_minor, h.state INTO held_amount, held_state
    FROM hold_entries he
    JOIN holds h ON h.tenant_id = he.tenant_id AND h.id = he.hold_id
    WHERE he.tenant_id = NEW.tenant_id AND he.account_id = NEW.account_id
      AND he.id = NEW.hold_entry_id AND h.ledger_id = NEW.ledger_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid tenant-scoped allocation relationship' USING ERRCODE = 'LL003';
  END IF;
  IF held_amount IS NULL OR held_amount <= 0 OR held_state <> 'HELD'
    OR (grant_expiration IS NOT NULL AND grant_expiration <= transaction_timestamp()) THEN
    RAISE EXCEPTION 'credit grant hold allocation scope is invalid';
  END IF;
  SELECT remaining_minor INTO capacity
    FROM credit_grant_capacity_versions
    WHERE tenant_id = NEW.tenant_id AND grant_id = NEW.grant_id
    ORDER BY version DESC LIMIT 1;
  SELECT active_credit_grant_reservation(NEW.tenant_id, NEW.grant_id) INTO reserved;
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
-- Appending to an existing allocation must recheck completeness, even when the
-- hold entry itself was not modified in this transaction.
CREATE FUNCTION assert_grant_allocation_total() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE held_amount bigint;
DECLARE allocated numeric;
BEGIN
  SELECT signed_amount_minor INTO held_amount FROM hold_entries
    WHERE tenant_id = NEW.tenant_id AND id = NEW.hold_entry_id;
  SELECT sum(amount_minor) INTO allocated FROM credit_grant_hold_allocations
    WHERE tenant_id = NEW.tenant_id AND hold_entry_id = NEW.hold_entry_id;
  IF allocated IS DISTINCT FROM held_amount::numeric THEN
    RAISE EXCEPTION 'grant hold allocation total must match immutable hold entry';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER credit_grant_hold_allocation_total
  AFTER INSERT ON credit_grant_hold_allocations DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_grant_allocation_total();--> statement-breakpoint
CREATE FUNCTION protect_allocated_hold_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM credit_grant_hold_allocations
    WHERE tenant_id = OLD.tenant_id AND hold_entry_id = OLD.id) THEN
    RAISE EXCEPTION 'allocated hold entries are immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;--> statement-breakpoint
CREATE TRIGGER allocated_hold_entries_immutable
  BEFORE UPDATE OR DELETE ON hold_entries
  FOR EACH ROW EXECUTE FUNCTION protect_allocated_hold_entry();--> statement-breakpoint
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
  SELECT active_credit_grant_reservation(NEW.tenant_id, NEW.grant_id) INTO reserved_amount;
  IF coalesce(remaining_amount, 0) <> reserved_amount THEN
    RAISE EXCEPTION 'expired credit grant cannot retain unreserved capacity';
  END IF;
  RETURN NEW;
END $$;

--> statement-breakpoint
-- Financial appends preserve the reserve, except consumption attached to a hold.
-- The existing lineage appender still owns all financial counters and version IDs.
CREATE OR REPLACE FUNCTION reject_credit_grant_capacity_baseline_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE linked_hold uuid;
DECLARE lineage credit_grant_entries%ROWTYPE;
BEGIN
  IF pg_trigger_depth() < 2 OR num_nonnulls(NEW.source_entry_id,
      NEW.source_allocation_id, NEW.source_hold_id) <> 1 THEN
    RAISE EXCEPTION 'credit grant capacity versions can only be appended from lineage or reservation events';
  END IF;
  IF NEW.source_entry_id IS NOT NULL THEN
    NEW.reserved_minor := active_credit_grant_reservation(NEW.tenant_id, NEW.grant_id);
    SELECT * INTO STRICT lineage FROM credit_grant_entries
      WHERE tenant_id = NEW.tenant_id AND grant_id = NEW.grant_id AND entry_id = NEW.source_entry_id;
    IF lineage.kind = 'CONSUMPTION' THEN
      SELECT t.hold_id INTO linked_hold FROM entries e
      JOIN transactions t ON t.tenant_id = e.tenant_id AND t.id = e.transaction_id
      WHERE e.tenant_id = NEW.tenant_id AND e.id = NEW.source_entry_id;
      IF linked_hold IS NOT NULL THEN
        NEW.reserved_minor := NEW.reserved_minor - lineage.amount_minor;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint

-- Only trigger callers may append reservation deltas. The grant row is the
-- serialization point; callers acquire account rows first. No SECURITY DEFINER.
CREATE FUNCTION append_credit_grant_reservation_version(
  p_tenant uuid, p_grant uuid, p_delta bigint, p_allocation uuid, p_hold uuid
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  IF pg_trigger_depth() = 0 THEN
    RAISE EXCEPTION 'reservation versions require a reservation event';
  END IF;
  PERFORM 1 FROM credit_grants WHERE tenant_id = p_tenant AND id = p_grant FOR UPDATE;
  INSERT INTO credit_grant_capacity_versions (
    tenant_id, ledger_id, account_id, grant_id, version, source_allocation_id, source_hold_id,
    granted_minor, reversed_minor, consumed_minor, compensated_minor, expired_minor,
    remaining_minor, reserved_minor
  ) SELECT tenant_id, ledger_id, account_id, grant_id, version + 1, p_allocation, p_hold,
    granted_minor, reversed_minor, consumed_minor, compensated_minor, expired_minor,
    remaining_minor, reserved_minor + p_delta
  FROM credit_grant_capacity_versions
  WHERE tenant_id = p_tenant AND grant_id = p_grant ORDER BY version DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'reservation requires an issued grant'; END IF;
END $$;--> statement-breakpoint
CREATE FUNCTION append_grant_allocation_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM append_credit_grant_reservation_version(NEW.tenant_id, NEW.grant_id,
    NEW.amount_minor, NEW.id, NULL);
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER credit_grant_allocation_reservation_appended
  AFTER INSERT ON credit_grant_hold_allocations
  FOR EACH ROW EXECUTE FUNCTION append_grant_allocation_reservation();--> statement-breakpoint

-- Finalization touches only this hold's provenance, never every hold for a grant.
-- Consumption already released its reserve in the financial version. APPLIED must
-- have no remainder; VOIDED releases exactly the unconsumed allocations once.
CREATE FUNCTION release_grant_hold_reservations() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE grant_row record;
DECLARE allocated bigint;
DECLARE consumed bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM hold_entries he JOIN credit_grant_hold_allocations a
      ON a.tenant_id = he.tenant_id AND a.hold_entry_id = he.id
      WHERE he.tenant_id = OLD.tenant_id AND he.hold_id = OLD.id) THEN
    RETURN NEW;
  END IF;
  IF NEW.state <> 'VOIDED' THEN RETURN NEW; END IF;
  PERFORM 1 FROM accounts ac WHERE ac.tenant_id = OLD.tenant_id AND ac.grant_enabled
    AND ac.id IN (SELECT account_id FROM hold_entries WHERE tenant_id = OLD.tenant_id AND hold_id = OLD.id)
    ORDER BY ac.id FOR UPDATE;
  FOR grant_row IN
    SELECT g.id FROM credit_grants g WHERE g.tenant_id = OLD.tenant_id AND g.id IN (
      SELECT a.grant_id FROM credit_grant_hold_allocations a JOIN hold_entries he
        ON he.tenant_id = a.tenant_id AND he.id = a.hold_entry_id
      WHERE he.tenant_id = OLD.tenant_id AND he.hold_id = OLD.id
    ) ORDER BY g.account_id, g.expires_at ASC NULLS LAST, g.created_at, g.id FOR UPDATE
  LOOP
    SELECT sum(a.amount_minor) INTO allocated FROM credit_grant_hold_allocations a
      JOIN hold_entries he ON he.tenant_id = a.tenant_id AND he.id = a.hold_entry_id
      WHERE a.tenant_id = OLD.tenant_id AND a.grant_id = grant_row.id AND he.hold_id = OLD.id;
    SELECT coalesce(sum(l.amount_minor), 0) INTO consumed FROM credit_grant_entries l
      JOIN entries e ON e.tenant_id = l.tenant_id AND e.id = l.entry_id
      JOIN transactions t ON t.tenant_id = e.tenant_id AND t.id = e.transaction_id
      WHERE l.tenant_id = OLD.tenant_id AND l.grant_id = grant_row.id
        AND l.kind = 'CONSUMPTION' AND t.hold_id = OLD.id;
    IF allocated < consumed THEN
      RAISE EXCEPTION 'allocated hold finalization does not match consumption' USING ERRCODE = 'LL001';
    END IF;
    IF allocated > consumed THEN
      PERFORM append_credit_grant_reservation_version(OLD.tenant_id, grant_row.id,
        consumed - allocated, NULL, OLD.id);
    END IF;
  END LOOP;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER grant_hold_reservations_released BEFORE UPDATE ON holds
  FOR EACH ROW EXECUTE FUNCTION release_grant_hold_reservations();
--> statement-breakpoint

-- Every hold starts HELD. API retries return the persisted result without UPDATE.
-- A SQL UPDATE must perform exactly one forward transition; identity is immutable.
CREATE FUNCTION guard_hold_lifecycle() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'hold history is immutable' USING ERRCODE = 'LL001';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'HELD' OR NEW.original_amount_minor <= 0
      OR NEW.remaining_amount_minor <> NEW.original_amount_minor
      OR NEW.applied_at IS NOT NULL OR NEW.voided_at IS NOT NULL THEN
      RAISE EXCEPTION 'hold must start with its full reservation' USING ERRCODE = 'LL001';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.id, NEW.tenant_id, NEW.ledger_id, NEW.asset_id, NEW.currency,
      NEW.reference, NEW.description, NEW.original_amount_minor, NEW.created_at)
    IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.ledger_id, OLD.asset_id, OLD.currency,
      OLD.reference, OLD.description, OLD.original_amount_minor, OLD.created_at) THEN
    RAISE EXCEPTION 'hold identity is immutable' USING ERRCODE = 'LL001';
  END IF;
  IF OLD.state <> 'HELD' THEN
    RAISE EXCEPTION 'finalized hold cannot transition' USING ERRCODE = 'LL001';
  END IF;
  IF NEW.state = 'HELD' AND NEW.remaining_amount_minor > 0
    AND NEW.remaining_amount_minor < OLD.remaining_amount_minor
    AND NEW.applied_at IS NULL AND NEW.voided_at IS NULL THEN RETURN NEW; END IF;
  IF NEW.state = 'APPLIED' AND NEW.remaining_amount_minor = 0
    AND NEW.applied_at IS NOT NULL AND NEW.voided_at IS NULL THEN RETURN NEW; END IF;
  IF NEW.state = 'VOIDED' AND NEW.remaining_amount_minor = 0
    AND NEW.applied_at IS NULL AND NEW.voided_at IS NOT NULL THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'invalid hold lifecycle transition' USING ERRCODE = 'LL001';
END $$;--> statement-breakpoint
CREATE TRIGGER a_hold_lifecycle_guard BEFORE INSERT OR UPDATE OR DELETE ON holds
  FOR EACH ROW EXECUTE FUNCTION guard_hold_lifecycle();--> statement-breakpoint

-- Check the final database state, not the order of writes inside a commit.
-- Only this hold's postings are scanned. Reversals have no hold_id and do not reopen it.
CREATE FUNCTION assert_grant_hold_consistent(p_tenant uuid, p_hold uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE h holds%ROWTYPE;
DECLARE initial numeric;
DECLARE committed numeric;
DECLARE net numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM hold_entries he JOIN accounts a
    ON a.tenant_id = he.tenant_id AND a.id = he.account_id
    WHERE he.tenant_id = p_tenant AND he.hold_id = p_hold AND a.grant_enabled) THEN RETURN; END IF;
  SELECT * INTO STRICT h FROM holds WHERE tenant_id = p_tenant AND id = p_hold;
  SELECT coalesce(sum(signed_amount_minor) FILTER (WHERE signed_amount_minor > 0), 0),
    coalesce(sum(signed_amount_minor), 0) INTO initial, net
    FROM hold_entries WHERE tenant_id = p_tenant AND hold_id = p_hold;
  IF initial <> h.original_amount_minor OR net <> 0 THEN
    RAISE EXCEPTION 'hold entries do not match original amount' USING ERRCODE = 'LL001';
  END IF;
  SELECT coalesce(sum(e.signed_amount_minor) FILTER (WHERE e.signed_amount_minor > 0), 0),
    coalesce(sum(e.signed_amount_minor), 0) INTO committed, net
    FROM transactions t JOIN entries e ON e.tenant_id = t.tenant_id AND e.transaction_id = t.id
    WHERE t.tenant_id = p_tenant AND t.hold_id = p_hold;
  IF net <> 0 OR committed > initial
    OR (h.state = 'HELD' AND h.remaining_amount_minor <> initial - committed)
    OR (h.state = 'APPLIED' AND committed <> initial)
    OR (h.state = 'VOIDED' AND committed >= initial) THEN
    RAISE EXCEPTION 'hold amounts disagree with committed postings' USING ERRCODE = 'LL001';
  END IF;
  IF EXISTS (
    WITH original AS (
      SELECT account_id, sign(signed_amount_minor) AS side, sum(abs(signed_amount_minor::numeric)) AS amount
      FROM hold_entries WHERE tenant_id = p_tenant AND hold_id = p_hold GROUP BY account_id, side
    ), posted AS (
      SELECT e.account_id, sign(e.signed_amount_minor) AS side, sum(abs(e.signed_amount_minor::numeric)) AS amount
      FROM transactions t JOIN entries e ON e.tenant_id = t.tenant_id AND e.transaction_id = t.id
      WHERE t.tenant_id = p_tenant AND t.hold_id = p_hold GROUP BY e.account_id, side
    ) SELECT 1 FROM original o FULL JOIN posted p USING (account_id, side)
      WHERE coalesce(p.amount, 0) * initial <> coalesce(o.amount, 0) * committed
  ) THEN
    RAISE EXCEPTION 'hold posting proportions do not match original entries' USING ERRCODE = 'LL001';
  END IF;
END $$;--> statement-breakpoint
CREATE FUNCTION check_grant_hold_consistency() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE linked_hold uuid;
BEGIN
  IF TG_TABLE_NAME = 'holds' THEN linked_hold := NEW.id;
  ELSIF TG_TABLE_NAME = 'hold_entries' THEN linked_hold := NEW.hold_id;
  ELSE
    SELECT hold_id INTO linked_hold FROM transactions WHERE tenant_id = NEW.tenant_id AND id = NEW.transaction_id;
  END IF;
  IF linked_hold IS NOT NULL THEN PERFORM assert_grant_hold_consistent(NEW.tenant_id, linked_hold); END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER grant_hold_amounts_consistent AFTER INSERT OR UPDATE ON holds
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_grant_hold_consistency();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER grant_hold_entries_consistent AFTER INSERT ON hold_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_grant_hold_consistency();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER grant_hold_postings_consistent AFTER INSERT ON entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_grant_hold_consistency();
--> statement-breakpoint
-- Hold reads and writes must use the same session tenant as allocation provenance.
ALTER TABLE holds ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE holds FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY holds_tenant_rls ON holds
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
ALTER TABLE hold_entries ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE hold_entries FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY hold_entries_tenant_rls ON hold_entries
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);--> statement-breakpoint
