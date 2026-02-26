ALTER TABLE "entries" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
UPDATE "entries"
SET "tenant_id" = "transactions"."tenant_id"
FROM "transactions"
WHERE "entries"."transaction_id" = "transactions"."id";--> statement-breakpoint
ALTER TABLE "entries" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "entries_tenant_id_idx" ON "entries" USING btree ("tenant_id");
