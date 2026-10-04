#!/usr/bin/env bash
set -euo pipefail

database_url="${DATABASE_URL_TEST:-postgresql://luxledger:luxledger@127.0.0.1:5433/luxledger_test}"
dump_directory=".tmp/migration-restore"
dump_file="$dump_directory/luxledger_test.dump"
sentinel_id="00000000-0000-4000-8000-000000000103"

for command in pg_dump pg_restore psql; do
  command -v "$command" >/dev/null || {
    echo "Missing required PostgreSQL client command: $command" >&2
    exit 1
  }
done

mkdir -p "$dump_directory"
rm -f "$dump_file"

DATABASE_URL_TEST="$database_url" bun run db:reset:test
DATABASE_URL_TEST="$database_url" bun run db:migrate:test
psql "$database_url" -v ON_ERROR_STOP=1 -c \
  "insert into tenants (id, name) values ('$sentinel_id', 'LL-103 restore sentinel')"
pg_dump "$database_url" --format=custom --no-owner --no-privileges --file="$dump_file"
test -s "$dump_file"

psql "$database_url" -v ON_ERROR_STOP=1 -c \
  'drop schema if exists drizzle cascade; drop schema public cascade; create schema public;'
pg_restore --dbname="$database_url" --no-owner --no-privileges --single-transaction --exit-on-error "$dump_file"

restored_name="$(psql "$database_url" -Atqc "select name from tenants where id = '$sentinel_id'")"
test "$restored_name" = 'LL-103 restore sentinel'
test "$(psql "$database_url" -Atqc 'select count(*) from drizzle.__drizzle_migrations')" -gt 0

echo 'Clean migration and backup/restore verification passed.'
