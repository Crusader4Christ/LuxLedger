# Contributor Workflow

Read the sections relevant to the task; repository-wide rules remain in `AGENTS.md`.

## Commands
- `bun install` — install dependencies
- `bun test` — run tests
- `bun run lint` — lint
- `bun run typecheck` — type check
- `bun run db:generate` — generate a named migration from the Drizzle schema
- `bun run db:migrate` — apply migrations

## Repo Map
- `packages/*` — all source; each package has its own `src/` (tests live beside code or in `test/integration/`)
- `drizzle/`, `drizzle.config.ts` — SQL migrations and Drizzle config
- `scripts/` — release, DB, and verification scripts
- `docs/` — ADRs, runbooks, schema and product docs
- `.github/` — CI workflows and PR template

## Local Setup
```sh
docker compose up -d          # PostgreSQL on :5432, test DB on :5433
cp .env.example .env          # configure DATABASE_URL
bun install
bunx drizzle-kit migrate
```

The reference API demo app lives in a separate repository. This repository owns the reusable packages, migrations, and HTTP/OpenAPI contract.

## Environment Variables
- `DATABASE_URL` — `postgresql://luxledger:luxledger@127.0.0.1:5432/luxledger`
- `DATABASE_URL_TEST` — `postgresql://luxledger:luxledger@127.0.0.1:5433/luxledger_test`
- `NODE_ENV` — `development` | `production` | `test`

## Git and Linear Procedures

Follow branch names, publication/privacy rules, and authorization requirements in root `AGENTS.md`.
For a new issue branch, fetch main first and create the branch from `origin/main`; continue existing
work on its task branch. Prepare PR prose in a file and pass it with `gh pr create --body-file`.

For Linear-backed tasks, map acceptance criteria to implementation and verification evidence. Before
an authorized completion update, summarize commands/results and any remaining gaps. Do not copy
unrelated issue context into a public PR. Use the developer, QA, or reviewer skill for the requested
role rather than loading all three.

## Boundary Review Checklist

Before finishing a change, verify:

- the package dependency direction still points inward toward `core`;
- new imports use public exports and do not create cross-boundary coupling;
- public exports, barrel files, declaration build inputs, and package metadata remain aligned;
- all package-local instructions applicable to the changed files were followed;
- documentation distinguishes current behavior from intended architecture; and
- the verification commands match the type of change described above.
