#!/usr/bin/env bash
set -euo pipefail

mkdir -p ./tmp/backups

docker compose exec -T postgres sh -lc \
  'PGPASSWORD=luxledger pg_dump -h 127.0.0.1 -p 5432 -U luxledger -Fc -f /tmp/luxledger.dump luxledger'
docker compose cp postgres:/tmp/luxledger.dump ./tmp/backups/luxledger.dump

docker compose exec -T postgres_test sh -lc \
  'PGPASSWORD=luxledger pg_dump -h 127.0.0.1 -p 5432 -U luxledger -Fc -f /tmp/luxledger_test.dump luxledger_test'
docker compose cp postgres_test:/tmp/luxledger_test.dump ./tmp/backups/luxledger_test.dump

ls -lh ./tmp/backups/luxledger.dump ./tmp/backups/luxledger_test.dump
