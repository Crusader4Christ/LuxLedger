CREATE FUNCTION reject_expiring_grant_enabled_funding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.expires_at IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM 1
    FROM accounts
    WHERE tenant_id = NEW.tenant_id
      AND id IN (NEW.account_id, NEW.funding_account_id)
    ORDER BY id
    FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM credit_grants
    WHERE tenant_id = NEW.tenant_id
      AND account_id = NEW.funding_account_id
  ) THEN
    RAISE EXCEPTION 'expiring credit grant funding account cannot be grant-enabled';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER expiring_grant_enabled_funding_guard
  BEFORE INSERT ON credit_grants
  FOR EACH ROW EXECUTE FUNCTION reject_expiring_grant_enabled_funding();
