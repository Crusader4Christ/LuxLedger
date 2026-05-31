CREATE OR REPLACE FUNCTION uuid_v7()
RETURNS uuid
LANGUAGE sql
VOLATILE
AS $$
  WITH ts AS (
    SELECT lpad(to_hex(floor(extract(epoch from clock_timestamp()) * 1000)::bigint), 12, '0') AS v
  ),
  rb AS (
    SELECT encode(gen_random_bytes(16), 'hex') AS v
  ),
  va AS (
    SELECT substr('89ab', (get_byte(gen_random_bytes(1), 0) % 4) + 1, 1) AS v
  )
  SELECT (
    substr(ts.v, 1, 8) || '-' ||
    substr(ts.v, 9, 4) || '-' ||
    '7' || substr(rb.v, 1, 3) || '-' ||
    va.v || substr(rb.v, 4, 3) || '-' ||
    substr(rb.v, 7, 12)
  )::uuid
  FROM ts, rb, va;
$$;

ALTER TABLE "tenants" ALTER COLUMN "id" SET DEFAULT uuid_v7();
ALTER TABLE "api_keys" ALTER COLUMN "id" SET DEFAULT uuid_v7();
ALTER TABLE "ledgers" ALTER COLUMN "id" SET DEFAULT uuid_v7();
ALTER TABLE "accounts" ALTER COLUMN "id" SET DEFAULT uuid_v7();
ALTER TABLE "holds" ALTER COLUMN "id" SET DEFAULT uuid_v7();
ALTER TABLE "hold_entries" ALTER COLUMN "id" SET DEFAULT uuid_v7();
ALTER TABLE "transactions" ALTER COLUMN "id" SET DEFAULT uuid_v7();
ALTER TABLE "entries" ALTER COLUMN "id" SET DEFAULT uuid_v7();
ALTER TABLE "balance_snapshots" ALTER COLUMN "id" SET DEFAULT uuid_v7();
