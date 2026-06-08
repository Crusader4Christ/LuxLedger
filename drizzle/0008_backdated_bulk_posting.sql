ALTER TABLE "transactions" ADD COLUMN "effective_at" timestamp with time zone DEFAULT now() NOT NULL;

CREATE INDEX "transactions_effective_at_idx" ON "transactions" ("tenant_id", "effective_at");
