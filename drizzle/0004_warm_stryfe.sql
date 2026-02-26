CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"key_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_role_chk" CHECK ("api_keys"."role" in ('ADMIN', 'SERVICE'))
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "api_keys_tenant_id_idx" ON "api_keys" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_key_hash_uq" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
ALTER TABLE "ledgers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "ledgers_tenant_rls" ON "ledgers"
  USING ("tenant_id"::text = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id"::text = current_setting('app.tenant_id', true));--> statement-breakpoint
CREATE POLICY "accounts_tenant_rls" ON "accounts"
  USING ("tenant_id"::text = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id"::text = current_setting('app.tenant_id', true));--> statement-breakpoint
CREATE POLICY "transactions_tenant_rls" ON "transactions"
  USING ("tenant_id"::text = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id"::text = current_setting('app.tenant_id', true));--> statement-breakpoint
CREATE POLICY "entries_tenant_rls" ON "entries"
  USING ("tenant_id"::text = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id"::text = current_setting('app.tenant_id', true));
