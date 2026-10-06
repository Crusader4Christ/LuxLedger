ALTER TABLE "entries" RENAME COLUMN "amount_minor" TO "signed_amount_minor";--> statement-breakpoint
ALTER TABLE "hold_entries" RENAME COLUMN "amount_minor" TO "signed_amount_minor";--> statement-breakpoint
UPDATE "entries" SET "signed_amount_minor" = -"signed_amount_minor" WHERE "direction" = 'CREDIT';--> statement-breakpoint
UPDATE "hold_entries" SET "signed_amount_minor" = -"signed_amount_minor" WHERE "direction" = 'CREDIT';--> statement-breakpoint
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_inflight_debit_nonnegative_chk";--> statement-breakpoint
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_inflight_credit_nonnegative_chk";--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "reserved_delta_minor" bigint;--> statement-breakpoint
ALTER TABLE "balance_snapshots" ADD COLUMN "reserved_delta_minor" bigint;--> statement-breakpoint
UPDATE "accounts"
SET
  "balance_minor" = -"balance_minor",
  "reserved_delta_minor" = CASE
    WHEN "side" = 'DEBIT' THEN -"inflight_credit_minor"
    ELSE "inflight_debit_minor"
  END;--> statement-breakpoint
UPDATE "balance_snapshots" AS snapshot
SET
  "posted_minor" = -snapshot."posted_minor",
  "reserved_delta_minor" = CASE
    WHEN account."side" = 'DEBIT' THEN -snapshot."inflight_credit_minor"
    ELSE snapshot."inflight_debit_minor"
  END
FROM "accounts" AS account
WHERE account."id" = snapshot."account_id";--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "reserved_delta_minor" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "reserved_delta_minor" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "balance_snapshots" ALTER COLUMN "reserved_delta_minor" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN "inflight_debit_minor";--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN "inflight_credit_minor";--> statement-breakpoint
ALTER TABLE "balance_snapshots" DROP COLUMN "inflight_debit_minor";--> statement-breakpoint
ALTER TABLE "balance_snapshots" DROP COLUMN "inflight_credit_minor";--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_credit_grant_entry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_transaction uuid;
DECLARE grant_expiration timestamptz;
DECLARE funding_account uuid;
DECLARE linked_transaction uuid;
DECLARE linked_signed_amount bigint;
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
  SELECT e.transaction_id, e.signed_amount_minor, t.relation_type, t.related_transaction_id,
         t.effective_at, abs(e.signed_amount_minor), e.asset_id, t.asset_id, a.asset_id
    INTO linked_transaction, linked_signed_amount, linked_relation, related_transaction,
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
    linked_transaction = source_transaction AND linked_signed_amount < 0
    AND NEW.amount_minor = entry_amount
    AND (grant_expiration IS NULL OR grant_expiration > transaction_timestamp())
  ) THEN
    RAISE EXCEPTION 'credit grant issuance link is invalid';
  ELSIF NEW.kind::text = 'REVERSAL' AND NOT (
    linked_relation = 'REVERSAL' AND related_transaction = source_transaction
    AND linked_signed_amount > 0 AND NEW.amount_minor = entry_amount
    AND issuance_amount > 0 AND NEW.amount_minor = issuance_amount
    AND available_amount = issuance_amount
    AND consumed_amount = 0 AND expired_amount = 0
  ) THEN
    RAISE EXCEPTION 'credit grant reversal link is invalid';
  ELSIF NEW.kind::text = 'CONSUMPTION' THEN
    IF linked_signed_amount <= 0 OR NEW.amount_minor > available_amount
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
      OR NEW.amount_minor <> entry_amount OR NEW.amount_minor > available_amount
      OR funding_credit <> NEW.amount_minor THEN
      RAISE EXCEPTION 'credit grant expiration link is invalid';
    END IF;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
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
    IF attributed_amount <> abs(NEW.signed_amount_minor) THEN
      RAISE EXCEPTION 'grant-enabled account entry requires complete grant attribution';
    END IF;
    SELECT relation_type, related_transaction_id INTO linked_relation, related_transaction
      FROM transactions WHERE id = NEW.transaction_id AND tenant_id = NEW.tenant_id;
    IF linked_relation::text = 'REVERSAL' THEN
      SELECT coalesce(sum(abs(signed_amount_minor)), 0) INTO original_amount
        FROM entries
        WHERE tenant_id = NEW.tenant_id AND transaction_id = related_transaction
          AND account_id = NEW.account_id
          AND ((signed_amount_minor < 0 AND NEW.signed_amount_minor > 0)
            OR (signed_amount_minor > 0 AND NEW.signed_amount_minor < 0));
      SELECT coalesce(sum(abs(signed_amount_minor)), 0) INTO reversal_amount
        FROM entries
        WHERE tenant_id = NEW.tenant_id AND transaction_id = NEW.transaction_id
          AND account_id = NEW.account_id
          AND ((signed_amount_minor > 0 AND NEW.signed_amount_minor > 0)
            OR (signed_amount_minor < 0 AND NEW.signed_amount_minor < 0));
      IF original_amount = 0 OR reversal_amount <> original_amount THEN
        RAISE EXCEPTION 'grant-enabled account reversal must exactly mirror original entries';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
ALTER TABLE "entries" DROP COLUMN "direction";--> statement-breakpoint
ALTER TABLE "hold_entries" DROP COLUMN "direction";--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_reserved_delta_side_chk" CHECK (("accounts"."side" = 'DEBIT' and "accounts"."reserved_delta_minor" <= 0) or ("accounts"."side" = 'CREDIT' and "accounts"."reserved_delta_minor" >= 0));--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_signed_amount_nonzero_chk" CHECK ("entries"."signed_amount_minor" <> 0);--> statement-breakpoint
ALTER TABLE "hold_entries" ADD CONSTRAINT "hold_entries_signed_amount_nonzero_chk" CHECK ("hold_entries"."signed_amount_minor" <> 0);--> statement-breakpoint
COMMENT ON COLUMN "accounts"."balance_minor" IS 'Posted signed balance: DEBIT entries are positive and CREDIT entries are negative.';--> statement-breakpoint
COMMENT ON COLUMN "accounts"."reserved_delta_minor" IS 'Signed pending delta that consumes natural balance; excludes capacity-increasing hold legs.';--> statement-breakpoint
COMMENT ON COLUMN "entries"."signed_amount_minor" IS 'Signed entry amount: positive is DEBIT and negative is CREDIT.';--> statement-breakpoint
COMMENT ON COLUMN "hold_entries"."signed_amount_minor" IS 'Signed held entry amount: positive is DEBIT and negative is CREDIT.';--> statement-breakpoint
COMMENT ON COLUMN "holds"."original_amount_minor" IS 'Positive debit-side magnitude used to scale partial commits.';--> statement-breakpoint
COMMENT ON COLUMN "holds"."remaining_amount_minor" IS 'Uncommitted portion of original_amount_minor; zero after full commit or void.';--> statement-breakpoint
COMMENT ON COLUMN "balance_snapshots"."posted_minor" IS 'Immutable account posted balance at the event boundary.';--> statement-breakpoint
COMMENT ON COLUMN "balance_snapshots"."reserved_delta_minor" IS 'Immutable account reservation delta at the event boundary.';--> statement-breakpoint
DROP TYPE "public"."entry_direction";
