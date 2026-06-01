alter table "transactions"
  add column "reversal_of_transaction_id" uuid references "transactions"("id") on update cascade on delete restrict;

create index "transactions_reversal_of_transaction_id_idx"
  on "transactions" ("reversal_of_transaction_id");

create unique index "transactions_reversal_of_transaction_id_uq"
  on "transactions" ("tenant_id", "reversal_of_transaction_id")
  where "reversal_of_transaction_id" is not null;
