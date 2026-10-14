ALTER TABLE "credit_grant_capacity_versions" ADD COLUMN "source_allocation_id" uuid;--> statement-breakpoint
ALTER TABLE "credit_grant_capacity_versions" ADD COLUMN "source_hold_id" uuid;--> statement-breakpoint
ALTER TABLE "credit_grant_capacity_versions" ADD COLUMN "reserved_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_grant_capacity_versions" ADD CONSTRAINT "credit_grant_capacity_versions_source_allocation_id_credit_grant_hold_allocations_id_fk" FOREIGN KEY ("source_allocation_id") REFERENCES "public"."credit_grant_hold_allocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_grant_capacity_versions" ADD CONSTRAINT "credit_grant_capacity_versions_source_hold_id_holds_id_fk" FOREIGN KEY ("source_hold_id") REFERENCES "public"."holds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_grant_capacity_versions_source_allocation_uq" ON "credit_grant_capacity_versions" USING btree ("source_allocation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_grant_capacity_versions_source_hold_uq" ON "credit_grant_capacity_versions" USING btree ("grant_id","source_hold_id");--> statement-breakpoint
ALTER TABLE "credit_grant_capacity_versions" ADD CONSTRAINT "credit_grant_capacity_versions_reserved_chk" CHECK ("credit_grant_capacity_versions"."reserved_minor" >= 0 and "credit_grant_capacity_versions"."reserved_minor" <= "credit_grant_capacity_versions"."remaining_minor");--> statement-breakpoint
-- Upgrade checkpoint: preserve existing financial versions and append the current
-- outstanding reservation once. This migration runs in a transaction; block writers
-- while reading provenance. Null source IDs identify this migration-only checkpoint.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'reservation snapshot backfill requires a migration role with BYPASSRLS';
  END IF;
END $$;--> statement-breakpoint
LOCK TABLE credit_grant_hold_allocations, credit_grant_entries, holds IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint
ALTER TABLE credit_grant_capacity_versions DISABLE TRIGGER credit_grant_capacity_baseline_guard;--> statement-breakpoint
INSERT INTO credit_grant_capacity_versions (
  tenant_id, ledger_id, account_id, grant_id, version, granted_minor, reversed_minor,
  consumed_minor, compensated_minor, expired_minor, remaining_minor, reserved_minor
)
SELECT v.tenant_id, v.ledger_id, v.account_id, v.grant_id, v.version + 1,
  v.granted_minor, v.reversed_minor, v.consumed_minor, v.compensated_minor,
  v.expired_minor, v.remaining_minor, r.amount
FROM (SELECT DISTINCT ON (tenant_id, grant_id) * FROM credit_grant_capacity_versions
      ORDER BY tenant_id, grant_id, version DESC) v
CROSS JOIN LATERAL (SELECT active_credit_grant_reservation(v.tenant_id, v.grant_id) AS amount) r
WHERE r.amount > 0;--> statement-breakpoint
ALTER TABLE credit_grant_capacity_versions ENABLE TRIGGER credit_grant_capacity_baseline_guard;--> statement-breakpoint

-- Reads no longer replay allocations or consumption. VOLATILE preserves visibility
-- of snapshots appended by earlier rows in the same statement.
CREATE OR REPLACE FUNCTION active_credit_grant_reservation(p_tenant uuid, p_grant uuid)
RETURNS numeric LANGUAGE sql VOLATILE SECURITY INVOKER AS $$
  SELECT coalesce((SELECT reserved_minor FROM credit_grant_capacity_versions
    WHERE tenant_id = p_tenant AND grant_id = p_grant ORDER BY version DESC LIMIT 1), 0)::numeric;
$$;--> statement-breakpoint

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
  IF (NEW.id, NEW.tenant_id, NEW.ledger_id, NEW.asset_id, NEW.original_amount_minor)
      IS DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.ledger_id, OLD.asset_id, OLD.original_amount_minor) THEN
    RAISE EXCEPTION 'allocated hold identity is immutable';
  END IF;
  IF NEW.state = OLD.state THEN RETURN NEW; END IF;
  IF OLD.state <> 'HELD' OR NEW.state NOT IN ('APPLIED', 'VOIDED') OR NEW.remaining_amount_minor <> 0 THEN
    RAISE EXCEPTION 'invalid allocated hold state transition';
  END IF;
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
    IF allocated < consumed OR (NEW.state = 'APPLIED' AND allocated <> consumed) THEN
      RAISE EXCEPTION 'allocated hold finalization does not match consumption';
    END IF;
    IF NEW.state = 'VOIDED' AND allocated > consumed THEN
      PERFORM append_credit_grant_reservation_version(OLD.tenant_id, grant_row.id,
        consumed - allocated, NULL, OLD.id);
    END IF;
  END LOOP;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER grant_hold_reservations_released BEFORE UPDATE ON holds
  FOR EACH ROW EXECUTE FUNCTION release_grant_hold_reservations();
