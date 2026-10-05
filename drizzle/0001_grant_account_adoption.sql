ALTER TABLE "accounts" ADD COLUMN "grant_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE accounts NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
UPDATE accounts a SET grant_enabled = true
WHERE EXISTS (
  SELECT 1 FROM credit_grants g
  WHERE g.tenant_id = a.tenant_id AND g.account_id = a.id
);--> statement-breakpoint
ALTER TABLE accounts FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE FUNCTION guard_grant_account_adoption() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.grant_enabled THEN
      RAISE EXCEPTION 'grant capability must be adopted after account creation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.grant_enabled AND NOT NEW.grant_enabled THEN
    RAISE EXCEPTION 'grant capability is irreversible';
  END IF;
  IF NOT OLD.grant_enabled AND NEW.grant_enabled AND (
    EXISTS (
      SELECT 1 FROM entries e
      WHERE e.tenant_id = NEW.tenant_id AND e.account_id = NEW.id
    ) OR EXISTS (
      SELECT 1 FROM hold_entries h
      WHERE h.tenant_id = NEW.tenant_id AND h.account_id = NEW.id
    )
  ) THEN
    RAISE EXCEPTION 'grant-enabled account must have no prior ledger or hold history';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER grant_account_adoption_guard
  BEFORE INSERT OR UPDATE OF grant_enabled ON accounts
  FOR EACH ROW EXECUTE FUNCTION guard_grant_account_adoption();--> statement-breakpoint
CREATE FUNCTION assert_grant_account_adoption_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.grant_enabled AND NOT EXISTS (
    SELECT 1 FROM credit_grants g
    WHERE g.tenant_id = NEW.tenant_id AND g.account_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'grant account adoption requires a credit grant';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER grant_account_adoption_complete
  AFTER UPDATE OF grant_enabled ON accounts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_grant_account_adoption_complete();--> statement-breakpoint
CREATE FUNCTION lock_entry_accounts_for_capability() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM a.id
  FROM accounts a
  WHERE a.tenant_id IN (SELECT DISTINCT tenant_id FROM inserted_entries)
    AND EXISTS (
      SELECT 1 FROM inserted_entries e
      WHERE e.tenant_id = a.tenant_id AND e.account_id = a.id
    )
  ORDER BY a.id
  FOR UPDATE;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER entry_accounts_capability_lock
  AFTER INSERT ON entries
  REFERENCING NEW TABLE AS inserted_entries
  FOR EACH STATEMENT EXECUTE FUNCTION lock_entry_accounts_for_capability();--> statement-breakpoint
DROP TRIGGER grant_account_holds_rejected ON hold_entries;--> statement-breakpoint
DROP FUNCTION reject_grant_account_hold();--> statement-breakpoint
CREATE FUNCTION lock_and_reject_grant_account_holds() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM a.id
  FROM accounts a
  WHERE a.tenant_id IN (SELECT DISTINCT tenant_id FROM inserted_holds)
    AND EXISTS (
      SELECT 1 FROM inserted_holds h
      WHERE h.tenant_id = a.tenant_id AND h.account_id = a.id
    )
  ORDER BY a.id
  FOR UPDATE;
  IF EXISTS (
    SELECT 1
    FROM inserted_holds h
    JOIN accounts a ON a.tenant_id = h.tenant_id AND a.id = h.account_id
    WHERE a.grant_enabled
  ) THEN
    RAISE EXCEPTION 'grant-enabled account holds require grant allocation';
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER grant_account_holds_rejected
  AFTER INSERT ON hold_entries
  REFERENCING NEW TABLE AS inserted_holds
  FOR EACH STATEMENT EXECUTE FUNCTION lock_and_reject_grant_account_holds();--> statement-breakpoint
CREATE FUNCTION require_grant_account_adoption() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE capability_enabled boolean;
BEGIN
  SELECT grant_enabled INTO capability_enabled
  FROM accounts
  WHERE tenant_id = NEW.tenant_id AND id = NEW.account_id
  FOR UPDATE;
  IF capability_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'credit grant account capability has not been adopted';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER credit_grants_require_account_adoption
  BEFORE INSERT ON credit_grants
  FOR EACH ROW EXECUTE FUNCTION require_grant_account_adoption();--> statement-breakpoint
CREATE OR REPLACE FUNCTION assert_grant_entry_attributed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE attributed_amount bigint;
DECLARE linked_relation transaction_relation_type;
DECLARE related_transaction uuid;
DECLARE original_amount bigint;
DECLARE reversal_amount bigint;
BEGIN
  IF EXISTS (
    SELECT 1 FROM accounts
      WHERE tenant_id = NEW.tenant_id AND id = NEW.account_id AND grant_enabled
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
