# Versioning, Migrations, and Publication

## Package and contract versions

LuxLedger packages are versioned independently. A host should pin a coordinated
set of core, HTTP, route-adapter, and PostgreSQL-adapter versions rather than
mixing arbitrary ranges. OpenAPI `info.version` identifies the HTTP contract;
it does not replace package versioning.

The current coordinated release is `0.3.0` for all public packages and the
OpenAPI contract. Its release surface is summarized in the
[0.3.0 release notes](../releases/0.3.0.md).

## Migration history

The current pre-production chain starts at `0000_initial-schema.sql` and
continues through the numbered migrations in `drizzle/`. The project has no
production database or supported legacy deployment. Development databases
created from retired migration files should be recreated from the current
chain.

## Publication checklist

Every contract-affecting release must update runtime contracts, OpenAPI,
examples, limitations, and release notes in the same PR. Before publication:

1. run unit and real-PostgreSQL integration tests, type checking, and linting;
2. run contract, release-readiness, and packed-package verification;
3. publish every package in the coordinated set;
4. install those published versions in the reference demo and regenerate its
   lockfile;
5. run the demo's `npm run verify:openapi` check, which compares its copied
   OpenAPI file byte-for-byte with the file exported by installed
   `@luxledger/http`;
6. run the demo integration and browser tests before marking the demo PR ready.

Documentation must describe only released or concurrently shipping behavior.
