# Versioning, Migrations, and Publication

## Compatibility

LuxLedger packages are versioned independently. A host should pin compatible released versions of core, HTTP, route adapter, and PostgreSQL adapter rather than mixing arbitrary ranges. The OpenAPI `info.version` identifies the HTTP contract version; it is not a substitute for package versions.

## Upgrade procedure

1. Read release notes and compare the canonical OpenAPI contract.
2. Upgrade all related LuxLedger packages together in a test environment.
3. Generate or inspect the required Drizzle migration and back up the database.
4. Apply migrations before starting code that depends on the new schema.
5. Run contract verification, type checking, unit tests, and real-PostgreSQL integration tests.
6. Exercise authentication, idempotent posting, trial balance, reversal/correction, holds, and reconciliation as applicable.
7. Deploy with the application's normal rollback and restore plan. Database rollback is never implied by downgrading packages.

## Documentation publication checklist

Every contract-affecting release must update runtime contracts, OpenAPI, examples, limitations, and migration notes in the same PR. CI runs `bun run contract:verify`; reviewers also verify links and ensure the demo pins published compatible versions. Documentation should describe only released or concurrently shipping behavior.

The reference demo copies the released OpenAPI contract for local Swagger UI. Its release process must verify that copy is byte-for-byte aligned with this repository and record the package versions used by the demo.

## LL-81 coordinated release checklist

| Component | Release version |
| --- | --- |
| `@luxledger/core` | `0.1.1` |
| `@luxledger/http` | `0.1.1` |
| `@luxledger/postgres-adapter` | `0.1.3` |
| `@luxledger/fastify-routes` | `0.1.2` |
| `@luxledger/express-routes` | `0.1.1` |
| OpenAPI `info.version` | `0.2.0` |

Publish these versions as one compatibility set. This is a backward-compatible correctness release: valid identical retries and public response schemas are unchanged; retries with a reused reference and changed description now fail as the documented payload mismatch. No database migration is required. Before publishing, build and pack all packages, run unit and real-PostgreSQL integration tests, typecheck, lint, contract verification, and verify the demo's OpenAPI copy byte-for-byte against the released `@luxledger/http` file. Do not describe this compatibility set as available until every package has been published.
