ALTER TABLE "transactions" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_metadata_object_chk" CHECK ("transactions"."metadata" is null or jsonb_typeof("transactions"."metadata") = 'object');--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_metadata_size_chk" CHECK ("transactions"."metadata" is null or octet_length("transactions"."metadata"::text) <= 16384);--> statement-breakpoint
CREATE FUNCTION protect_transaction_metadata() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.metadata IS DISTINCT FROM NEW.metadata THEN
    RAISE EXCEPTION 'transaction metadata is immutable';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER transaction_metadata_immutable BEFORE UPDATE OF metadata ON transactions
  FOR EACH ROW EXECUTE FUNCTION protect_transaction_metadata();
