CREATE TYPE "public"."reconciliation_run_status" AS ENUM('pending', 'running', 'completed', 'failed');
CREATE TYPE "public"."reconciliation_result_status" AS ENUM('matched', 'unmatched_external', 'unmatched_internal', 'mismatched', 'conflict');

CREATE TABLE "recon_uploads" (
  "id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "source" text NOT NULL,
  "record_count" bigint NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "recon_records" (
  "id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "upload_id" uuid NOT NULL,
  "external_id" text NOT NULL,
  "source" text NOT NULL,
  "amount_minor" bigint NOT NULL,
  "currency" text NOT NULL,
  "reference" text NOT NULL,
  "description" text,
  "occurred_at" timestamp with time zone NOT NULL,
  "raw" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "recon_rules" (
  "id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "criteria" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "recon_runs" (
  "id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "ledger_id" uuid NOT NULL,
  "upload_id" uuid NOT NULL,
  "strategy" text NOT NULL,
  "status" "reconciliation_run_status" DEFAULT 'pending' NOT NULL,
  "dry_run" boolean DEFAULT false NOT NULL,
  "matched_count" bigint DEFAULT 0 NOT NULL,
  "unmatched_external_count" bigint DEFAULT 0 NOT NULL,
  "unmatched_internal_count" bigint DEFAULT 0 NOT NULL,
  "mismatched_count" bigint DEFAULT 0 NOT NULL,
  "conflict_count" bigint DEFAULT 0 NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);

CREATE TABLE "recon_results" (
  "id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "run_id" uuid NOT NULL,
  "external_record_id" uuid,
  "external_id" text,
  "transaction_id" uuid,
  "status" "reconciliation_result_status" NOT NULL,
  "reason" text NOT NULL,
  "candidate_transaction_ids" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "recon_uploads" ADD CONSTRAINT "recon_uploads_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE cascade;
ALTER TABLE "recon_records" ADD CONSTRAINT "recon_records_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE cascade;
ALTER TABLE "recon_records" ADD CONSTRAINT "recon_records_upload_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."recon_uploads"("id") ON DELETE restrict ON UPDATE cascade;
ALTER TABLE "recon_rules" ADD CONSTRAINT "recon_rules_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE cascade;
ALTER TABLE "recon_runs" ADD CONSTRAINT "recon_runs_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE cascade;
ALTER TABLE "recon_runs" ADD CONSTRAINT "recon_runs_ledger_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."ledgers"("id") ON DELETE restrict ON UPDATE cascade;
ALTER TABLE "recon_runs" ADD CONSTRAINT "recon_runs_upload_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."recon_uploads"("id") ON DELETE restrict ON UPDATE cascade;
ALTER TABLE "recon_results" ADD CONSTRAINT "recon_results_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE cascade;
ALTER TABLE "recon_results" ADD CONSTRAINT "recon_results_run_fk" FOREIGN KEY ("run_id") REFERENCES "public"."recon_runs"("id") ON DELETE restrict ON UPDATE cascade;
ALTER TABLE "recon_results" ADD CONSTRAINT "recon_results_external_record_fk" FOREIGN KEY ("external_record_id") REFERENCES "public"."recon_records"("id") ON DELETE restrict ON UPDATE cascade;
ALTER TABLE "recon_results" ADD CONSTRAINT "recon_results_transaction_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE restrict ON UPDATE cascade;

CREATE INDEX "recon_uploads_tenant_idx" ON "recon_uploads" USING btree ("tenant_id");
CREATE INDEX "recon_uploads_source_idx" ON "recon_uploads" USING btree ("tenant_id","source");
CREATE INDEX "recon_records_upload_idx" ON "recon_records" USING btree ("tenant_id","upload_id");
CREATE UNIQUE INDEX "recon_records_source_external_uq" ON "recon_records" USING btree ("tenant_id","source","external_id");
CREATE INDEX "recon_rules_tenant_idx" ON "recon_rules" USING btree ("tenant_id");
CREATE UNIQUE INDEX "recon_rules_tenant_name_uq" ON "recon_rules" USING btree ("tenant_id","name");
CREATE INDEX "recon_runs_tenant_idx" ON "recon_runs" USING btree ("tenant_id");
CREATE INDEX "recon_runs_upload_idx" ON "recon_runs" USING btree ("upload_id");
CREATE INDEX "recon_results_run_idx" ON "recon_results" USING btree ("run_id");
CREATE INDEX "recon_results_tenant_status_idx" ON "recon_results" USING btree ("tenant_id","status");

ALTER TABLE "recon_runs" ADD CONSTRAINT "recon_runs_strategy_ck" CHECK ("recon_runs"."strategy" = 'one_to_one');
