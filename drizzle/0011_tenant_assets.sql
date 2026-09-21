-- Reject inconsistent legacy rows before any identity is assigned.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM accounts a JOIN ledgers l ON l.id = a.ledger_id WHERE a.tenant_id <> l.tenant_id
  ) OR EXISTS (
    SELECT 1 FROM transactions t JOIN ledgers l ON l.id = t.ledger_id WHERE t.tenant_id <> l.tenant_id
  ) OR EXISTS (
    SELECT 1 FROM holds h JOIN ledgers l ON l.id = h.ledger_id WHERE h.tenant_id <> l.tenant_id
  ) THEN
    RAISE EXCEPTION 'Existing ledger tenant mismatch; repair before migration';
  END IF;
  IF EXISTS (
    SELECT 1 FROM entries e JOIN transactions t ON t.id = e.transaction_id
      JOIN accounts a ON a.id = e.account_id
    WHERE e.tenant_id <> t.tenant_id OR e.tenant_id <> a.tenant_id
      OR t.ledger_id <> a.ledger_id OR e.currency <> t.currency OR e.currency <> a.currency
  ) OR EXISTS (
    SELECT 1 FROM hold_entries e JOIN holds h ON h.id = e.hold_id
      JOIN accounts a ON a.id = e.account_id
    WHERE e.tenant_id <> h.tenant_id OR e.tenant_id <> a.tenant_id
      OR h.ledger_id <> a.ledger_id OR e.currency <> h.currency OR e.currency <> a.currency
  ) OR EXISTS (
    SELECT 1 FROM transactions t JOIN holds h ON h.id = t.hold_id
    WHERE t.tenant_id <> h.tenant_id OR t.ledger_id <> h.ledger_id OR t.currency <> h.currency
  ) THEN
    RAISE EXCEPTION 'Existing ledger asset/currency mismatch; repair before migration';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (
      SELECT currency FROM accounts UNION SELECT currency FROM transactions
      UNION SELECT currency FROM entries UNION SELECT currency FROM holds
      UNION SELECT currency FROM hold_entries
    ) used WHERE currency NOT IN ('CREDIT', 'EUR', 'USD', 'USDC')
  ) THEN
    RAISE EXCEPTION 'Unknown legacy currency scale; define a reviewed scale mapping before migration';
  END IF;
END $$;

CREATE TABLE assets (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE restrict,
  code text NOT NULL,
  scale integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assets_code_chk CHECK (code ~ '^[A-Z][A-Z0-9_]{1,31}$'),
  CONSTRAINT assets_scale_chk CHECK (scale BETWEEN 0 AND 18),
  CONSTRAINT assets_tenant_code_uq UNIQUE (tenant_id, code),
  CONSTRAINT assets_tenant_id_uq UNIQUE (tenant_id, id)
);
INSERT INTO assets (tenant_id, code, scale)
SELECT tenant_id, currency,
  CASE currency WHEN 'CREDIT' THEN 0 WHEN 'USDC' THEN 6 ELSE 2 END
FROM (
  SELECT tenant_id, currency FROM accounts UNION SELECT tenant_id, currency FROM transactions
  UNION SELECT tenant_id, currency FROM entries UNION SELECT tenant_id, currency FROM holds
  UNION SELECT tenant_id, currency FROM hold_entries
) used;

ALTER TABLE accounts ADD COLUMN asset_id uuid;
ALTER TABLE transactions ADD COLUMN asset_id uuid;
ALTER TABLE entries ADD COLUMN asset_id uuid;
ALTER TABLE holds ADD COLUMN asset_id uuid;
ALTER TABLE hold_entries ADD COLUMN asset_id uuid;

UPDATE accounts r SET asset_id = a.id FROM assets a WHERE a.tenant_id = r.tenant_id AND a.code = r.currency;
UPDATE transactions r SET asset_id = a.id FROM assets a WHERE a.tenant_id = r.tenant_id AND a.code = r.currency;
UPDATE entries r SET asset_id = a.id FROM assets a WHERE a.tenant_id = r.tenant_id AND a.code = r.currency;
UPDATE holds r SET asset_id = a.id FROM assets a WHERE a.tenant_id = r.tenant_id AND a.code = r.currency;
UPDATE hold_entries r SET asset_id = a.id FROM assets a WHERE a.tenant_id = r.tenant_id AND a.code = r.currency;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM accounts WHERE asset_id IS NULL)
    OR EXISTS (SELECT 1 FROM transactions WHERE asset_id IS NULL)
    OR EXISTS (SELECT 1 FROM entries WHERE asset_id IS NULL)
    OR EXISTS (SELECT 1 FROM holds WHERE asset_id IS NULL)
    OR EXISTS (SELECT 1 FROM hold_entries WHERE asset_id IS NULL)
    OR EXISTS (SELECT 1 FROM entries e JOIN transactions t ON t.id = e.transaction_id
      JOIN accounts a ON a.id = e.account_id WHERE e.asset_id <> t.asset_id OR e.asset_id <> a.asset_id)
    OR EXISTS (SELECT 1 FROM hold_entries e JOIN holds h ON h.id = e.hold_id
      JOIN accounts a ON a.id = e.account_id WHERE e.asset_id <> h.asset_id OR e.asset_id <> a.asset_id)
  THEN RAISE EXCEPTION 'Asset backfill verification failed'; END IF;
END $$;

ALTER TABLE accounts ALTER COLUMN asset_id SET NOT NULL;
ALTER TABLE transactions ALTER COLUMN asset_id SET NOT NULL;
ALTER TABLE entries ALTER COLUMN asset_id SET NOT NULL;
ALTER TABLE holds ALTER COLUMN asset_id SET NOT NULL;
ALTER TABLE hold_entries ALTER COLUMN asset_id SET NOT NULL;

ALTER TABLE accounts ADD CONSTRAINT accounts_asset_fk FOREIGN KEY (tenant_id, asset_id) REFERENCES assets(tenant_id, id);
ALTER TABLE transactions ADD CONSTRAINT transactions_asset_fk FOREIGN KEY (tenant_id, asset_id) REFERENCES assets(tenant_id, id);
ALTER TABLE entries ADD CONSTRAINT entries_asset_fk FOREIGN KEY (tenant_id, asset_id) REFERENCES assets(tenant_id, id);
ALTER TABLE holds ADD CONSTRAINT holds_asset_fk FOREIGN KEY (tenant_id, asset_id) REFERENCES assets(tenant_id, id);
ALTER TABLE hold_entries ADD CONSTRAINT hold_entries_asset_fk FOREIGN KEY (tenant_id, asset_id) REFERENCES assets(tenant_id, id);

CREATE FUNCTION asset_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.code <> OLD.code OR NEW.scale <> OLD.scale THEN
    RAISE EXCEPTION 'Asset code and scale are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assets_identity_guard BEFORE UPDATE ON assets FOR EACH ROW EXECUTE FUNCTION asset_identity_guard();

CREATE FUNCTION account_asset_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.asset_id <> OLD.asset_id AND EXISTS (SELECT 1 FROM entries WHERE account_id = OLD.id) THEN
    RAISE EXCEPTION 'Account asset cannot change after ledger history exists';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER accounts_asset_history_guard BEFORE UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION account_asset_history_guard();

-- Enable tenant isolation only after the migration has completed its backfill.
-- Runtime connections must set app.tenant_id before accessing assets.
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets FORCE ROW LEVEL SECURITY;
CREATE POLICY assets_tenant_rls ON assets
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
