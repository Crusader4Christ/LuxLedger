ALTER TABLE "accounts" ADD COLUMN "grant_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_grant_enabled_shape_chk" CHECK (not "accounts"."grant_enabled" or ("accounts"."side" = 'CREDIT' and "accounts"."overdraft_policy" = 'DISALLOW'));--> statement-breakpoint
CREATE FUNCTION reject_grant_capability_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.grant_enabled IS DISTINCT FROM NEW.grant_enabled THEN
    RAISE EXCEPTION 'account grant capability is immutable';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER account_grant_capability_immutable
  BEFORE UPDATE OF grant_enabled ON accounts
  FOR EACH ROW EXECUTE FUNCTION reject_grant_capability_change();--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_grant_account_hold() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM accounts a
    WHERE a.tenant_id = NEW.tenant_id AND a.id = NEW.account_id AND a.grant_enabled
  ) THEN
    RAISE EXCEPTION 'grant-enabled account holds require grant allocation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
DROP TRIGGER grant_account_holds_rejected ON hold_entries;--> statement-breakpoint
CREATE TRIGGER grant_account_holds_rejected
  BEFORE INSERT ON hold_entries
  FOR EACH ROW EXECUTE FUNCTION reject_grant_account_hold();--> statement-breakpoint
CREATE FUNCTION require_grant_enabled_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM accounts
      WHERE tenant_id = NEW.tenant_id AND id = NEW.account_id AND grant_enabled
  ) THEN
    RAISE EXCEPTION 'credit grants require a grant-enabled account';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER credit_grants_require_enabled_account
  BEFORE INSERT ON credit_grants
  FOR EACH ROW EXECUTE FUNCTION require_grant_enabled_account();--> statement-breakpoint
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
