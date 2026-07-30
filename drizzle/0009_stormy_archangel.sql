ALTER TABLE "accounts" ADD COLUMN "code" text;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_ledger_code_uq" ON "accounts" USING btree ("tenant_id","ledger_id","code") WHERE "accounts"."code" is not null;
