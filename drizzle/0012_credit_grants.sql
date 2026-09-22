CREATE TYPE "public"."credit_grant_origin" AS ENUM('PURCHASED', 'PROMOTIONAL', 'TRIAL', 'COMPENSATION');--> statement-breakpoint
CREATE TABLE "credit_grant_reversals" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ledger_id" uuid NOT NULL,
	"grant_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"transaction_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_grants" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"ledger_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"funding_account_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"external_reference" text,
	"origin" "credit_grant_origin" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"refundable" boolean NOT NULL,
	"transferable" boolean NOT NULL,
	"consumption_priority" integer NOT NULL,
	"eligibility" text,
	"transaction_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_grants_amount_chk" CHECK ("credit_grants"."amount_minor" > 0),
	CONSTRAINT "credit_grants_accounts_chk" CHECK ("credit_grants"."account_id" <> "credit_grants"."funding_account_id"),
	CONSTRAINT "credit_grants_priority_chk" CHECK ("credit_grants"."consumption_priority" >= 0),
	CONSTRAINT "credit_grants_policy_chk" CHECK (("credit_grants"."origin" <> 'PURCHASED' or "credit_grants"."refundable") and ("credit_grants"."origin" <> 'PROMOTIONAL' or (not "credit_grants"."refundable" and not "credit_grants"."transferable"))),
	CONSTRAINT "credit_grants_eligibility_v1_chk" CHECK ("credit_grants"."eligibility" is null)
);
--> statement-breakpoint
ALTER TABLE "credit_grant_reversals" ADD CONSTRAINT "credit_grant_reversals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_grants" ADD CONSTRAINT "credit_grants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ledgers_tenant_id_uq" ON "ledgers" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_tenant_ledger_id_uq" ON "accounts" USING btree ("tenant_id","ledger_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_tenant_ledger_id_uq" ON "transactions" USING btree ("tenant_id","ledger_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_grants_tenant_id_uq" ON "credit_grants" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_grants_tenant_ledger_id_uq" ON "credit_grants" USING btree ("tenant_id","ledger_id","id");--> statement-breakpoint
ALTER TABLE "credit_grant_reversals" ADD CONSTRAINT "credit_grant_reversals_grant_fk" FOREIGN KEY ("tenant_id","ledger_id","grant_id") REFERENCES "public"."credit_grants"("tenant_id","ledger_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_grant_reversals" ADD CONSTRAINT "credit_grant_reversals_transaction_scope_fk" FOREIGN KEY ("tenant_id","ledger_id","transaction_id") REFERENCES "public"."transactions"("tenant_id","ledger_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_grants" ADD CONSTRAINT "credit_grants_tenant_ledger_fk" FOREIGN KEY ("tenant_id","ledger_id") REFERENCES "public"."ledgers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_grants" ADD CONSTRAINT "credit_grants_account_scope_fk" FOREIGN KEY ("tenant_id","ledger_id","account_id") REFERENCES "public"."accounts"("tenant_id","ledger_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_grants" ADD CONSTRAINT "credit_grants_funding_account_scope_fk" FOREIGN KEY ("tenant_id","ledger_id","funding_account_id") REFERENCES "public"."accounts"("tenant_id","ledger_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_grants" ADD CONSTRAINT "credit_grants_transaction_scope_fk" FOREIGN KEY ("tenant_id","ledger_id","transaction_id") REFERENCES "public"."transactions"("tenant_id","ledger_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_grants" ADD CONSTRAINT "credit_grants_asset_fk" FOREIGN KEY ("tenant_id","asset_id") REFERENCES "public"."assets"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_grant_reversals_grant_uq" ON "credit_grant_reversals" USING btree ("grant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_grant_reversals_tenant_reference_uq" ON "credit_grant_reversals" USING btree ("tenant_id","reference");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_grant_reversals_transaction_uq" ON "credit_grant_reversals" USING btree ("transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_grants_tenant_reference_uq" ON "credit_grants" USING btree ("tenant_id","reference");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_grants_transaction_uq" ON "credit_grants" USING btree ("transaction_id");
--> statement-breakpoint
ALTER TABLE credit_grants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE credit_grants FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY credit_grants_tenant_rls ON credit_grants USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE credit_grant_reversals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE credit_grant_reversals FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY credit_grant_reversals_tenant_rls ON credit_grant_reversals USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
CREATE FUNCTION reject_credit_grant_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'credit grant history is immutable'; END $$;
--> statement-breakpoint
CREATE TRIGGER credit_grants_immutable BEFORE UPDATE OR DELETE ON credit_grants FOR EACH ROW EXECUTE FUNCTION reject_credit_grant_mutation();
--> statement-breakpoint
CREATE TRIGGER credit_grant_reversals_immutable BEFORE UPDATE OR DELETE ON credit_grant_reversals FOR EACH ROW EXECUTE FUNCTION reject_credit_grant_mutation();
