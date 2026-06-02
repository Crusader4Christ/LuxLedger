CREATE TYPE "transaction_relation_type" AS ENUM('REVERSAL', 'CORRECTION');

alter table "transactions"
  add column "related_transaction_id" uuid references "transactions"("id") on update cascade on delete restrict,
  add column "relation_type" "transaction_relation_type",
  add constraint "transactions_relation_pair_ck"
    check (
      ("related_transaction_id" is null and "relation_type" is null)
      or ("related_transaction_id" is not null and "relation_type" is not null)
    );

create index "transactions_related_transaction_id_idx"
  on "transactions" ("related_transaction_id");

create unique index "transactions_relation_uq"
  on "transactions" ("tenant_id", "relation_type", "related_transaction_id")
  where "related_transaction_id" is not null;
