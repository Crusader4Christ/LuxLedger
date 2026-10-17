# Release Policy

## Coordinated semantic versions

All public `@luxledger/*` packages and OpenAPI `info.version` ship as one
coordinated SemVer version. Internal package dependencies use the caret range
for that exact version. Consumers should upgrade the complete set together and
commit their lockfile; mixed LuxLedger versions are unsupported.

Before `1.0.0`, a breaking public contract change increments the minor version.
After `1.0.0`, it increments the major version. Additive, backward-compatible
behavior increments the minor version and backward-compatible fixes increment
the patch version. A database migration alone follows the impact of the package
or contract change it supports.

Public contract includes exported TypeScript names and subpaths, HTTP requests,
responses and errors, OpenAPI, persisted schema and migration expectations, and
documented ledger behavior. Correcting behavior that contradicted an invariant
is a fix only when the old behavior was neither documented nor safe to rely on.

## Breaking changes and deprecations

A breaking change must be called out under `Unreleased` in `CHANGELOG.md`, in
the versioned release notes, and in an upgrade section with an integrator action.
When safety permits, deprecated APIs remain available for at least one minor
release and produce a documented replacement before removal. Security or ledger
correctness issues may require immediate removal; the release notes must explain
the exception and mitigation.

## Tags and publication

- Stable versions publish under the npm `latest` tag.
- Prerelease SemVer versions publish under `next`; they never move `latest`.
- Git tags and GitHub releases use `v<version>` and are created only after every
  package is visible in npm.
- npm publication runs from `main` in the `Release` GitHub Actions workflow.
  The publish job uses trusted publishing/OIDC and `--provenance`; no long-lived
  npm token is required when the npm package trust relationship is configured.

The workflow is rerunnable. It skips a package version already present in npm
and publishes missing packages in dependency order. Because npm has no atomic
multi-package transaction, do not move a dist-tag or create the GitHub release
until all five package versions are present.

## Release checklist

1. Choose a SemVer version, update all package manifests, internal dependency
   ranges, OpenAPI, `CHANGELOG.md`, and `docs/releases/<version>.md` in one PR.
2. Document breaking changes, deprecations, idempotency changes, and operator
   migration steps. Add an upgrade test from the latest published version when
   the schema changes.
3. Pass unit and PostgreSQL integration tests, lint, typecheck, build,
   `contract:verify`, `release:verify`, `migration:verify`, and `pack:verify`.
4. Run the `Release` workflow with publication disabled. Download and inspect
   its installable package tarballs.
5. Run the same workflow with publication enabled and the correct npm tag.
6. Confirm all versions and provenance in npm, then create `v<version>` and the
   GitHub release from the versioned notes.
7. Upgrade the reference demo as a consumer, regenerate its lockfile, verify its
   OpenAPI copy, and run its integration and browser tests.

## Recovery

Published npm versions are immutable. If publication stops part way, rerun the
same workflow and version; already published versions are detected and skipped.
If an incorrect artifact was published, deprecate it in npm and release a new
patch version. Never overwrite a tag or attempt to reuse the version.
