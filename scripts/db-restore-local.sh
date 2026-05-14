#!/usr/bin/env bash
set -euo pipefail

test -s ./tmp/backups/luxledger.dump
test -s ./tmp/backups/luxledger_test.dump

docker compose cp ./tmp/backups/luxledger.dump postgres:/tmp/luxledger.dump
docker compose exec -T postgres sh -lc \
  'PGPASSWORD=luxledger pg_restore -h 127.0.0.1 -p 5432 -U luxledger --clean --if-exists --no-owner --no-privileges -d luxledger /tmp/luxledger.dump'

docker compose cp ./tmp/backups/luxledger_test.dump postgres_test:/tmp/luxledger_test.dump
docker compose exec -T postgres_test sh -lc \
  'PGPASSWORD=luxledger pg_restore -h 127.0.0.1 -p 5432 -U luxledger --clean --if-exists --no-owner --no-privileges -d luxledger_test /tmp/luxledger_test.dump'
