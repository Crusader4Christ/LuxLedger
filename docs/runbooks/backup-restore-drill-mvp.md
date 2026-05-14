# Backup and Restore Drill MVP Runbook

## Scope

This runbook defines the MVP local backup/restore drill baseline for LL-35.

Recovery targets in scope:

- Primary local app database: `luxledger` on `127.0.0.1:5432` (`docker` service `postgres`).
- Local test database: `luxledger_test` on `127.0.0.1:5433` (`docker` service `postgres_test`).

Out of scope for this phase:

- CI backup/restore automation.
- Production/staging backup policy.
- Schema or API behavior changes.

## Prerequisites

- Docker is running and local services are up:
  - `docker compose up -d`
- Bun dependencies are installed:
  - `bun install`
- `.env` is configured from `.env.example` and contains:
  - `DATABASE_URL=postgresql://luxledger:luxledger@127.0.0.1:5432/luxledger`
  - `DATABASE_URL_TEST=postgresql://luxledger:luxledger@127.0.0.1:5433/luxledger_test`
- PostgreSQL client tools are available locally:
  - Not required on host; backup/restore is executed through Docker containers.
- Export database URLs in the same shell before running commands:

```sh
export DATABASE_URL=postgresql://luxledger:luxledger@127.0.0.1:5432/luxledger
export DATABASE_URL_TEST=postgresql://luxledger:luxledger@127.0.0.1:5433/luxledger_test
```

## Baseline Health Checks

1. Verify primary DB is reachable:

```sh
DATABASE_URL=${DATABASE_URL:-postgresql://luxledger:luxledger@127.0.0.1:5432/luxledger} \
  bun run ./scripts/check-postgres.ts
```

2. Verify test DB is reachable:

```sh
bun run db:check:test
```

3. Ensure test schema can be recreated cleanly:

```sh
bun run db:reset:test
bun run db:migrate:test
```

## Backup Commands (Local MVP)

Create a local backup directory:

```sh
mkdir -p ./tmp/backups
```

Use helper script:

```sh
./scripts/db-backup-local.sh
```

## Restore Commands (Local MVP)

Note: this drill restores schema + data into the same local DB names.

Use helper script:

```sh
./scripts/db-restore-local.sh
```

## Verification Checklist

- Backup files exist and are non-empty:
  - `./tmp/backups/luxledger.dump`
  - `./tmp/backups/luxledger_test.dump`
- Primary and test DB are reachable after restore:
  - `bun run ./scripts/check-postgres.ts`
  - `bun run db:check:test`
- Public table counts are unchanged pre/post restore for both DBs.
- Test schema can be rebuilt after restore:
  - `bun run db:reset:test`
  - `bun run db:migrate:test`
- Integration test flow for test DB remains functional:
  - `bun run test:integration`

## Failure Signals

- `scripts/check-postgres.ts` reports connectivity failure.
- `pg_dump` exits non-zero or creates empty output files.
- `pg_restore` fails with schema/object errors.
- `bun run db:reset:test` or `bun run db:migrate:test` fails after restore.
- `bun run test:integration` fails due to missing tables or inconsistent state.

## Assumptions and Limitations (Phase 1 MVP)

- Local environment only; no remote backup storage.
- Credentials are local dev defaults from `docker-compose.yml`.
- Backup artifacts are not encrypted.
- No point-in-time recovery (PITR); only snapshot dump/restore.
- Restore target names are fixed (`luxledger`, `luxledger_test`).
- Primary DB migration history can differ by local state; this runbook verifies restore integrity without mutating primary migration state.

## Execution Baseline (Observed)

- Drill date: `2026-05-14`
- Branch: `codex/LL-35-backup-restore-drill`
- Backup artifacts:
  - `./tmp/backups/luxledger.dump` (`13K`)
  - `./tmp/backups/luxledger_test.dump` (`20K`)
- Observed backup + restore time (MVP baseline): `2s`
- Total drill command sequence time (including verification/tests): `4s`
- Verification evidence:
  - Primary table count before/after restore: `5` / `5`
  - Test table count before/after restore: `6` / `6`
  - `bun run test:integration`: passed (`86` pass, `0` fail)
