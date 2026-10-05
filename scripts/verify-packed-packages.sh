#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SMOKE_DIR="$ROOT_DIR/.tmp/package-smoke"
TARBALL_DIR="$SMOKE_DIR/tarballs"

rm -rf "$SMOKE_DIR"
mkdir -p "$TARBALL_DIR"

export npm_config_cache="$ROOT_DIR/.tmp/npm-cache"

pack_workspace() {
  npm pack --workspace "$1" --pack-destination "$TARBALL_DIR" >/dev/null
}

pack_workspace "@luxledger/core"
pack_workspace "@luxledger/http"
pack_workspace "@luxledger/postgres-adapter"
pack_workspace "@luxledger/fastify-routes"
pack_workspace "@luxledger/express-routes"

cd "$SMOKE_DIR"
npm init --yes >/dev/null
npm install --ignore-scripts --no-package-lock "$TARBALL_DIR"/*.tgz

node --input-type=module <<'NODE'
await import('@luxledger/core');
await import('@luxledger/core/application');
await import('@luxledger/core/base');
await import('@luxledger/core/utils');
await import('@luxledger/http');
await import('@luxledger/http/contracts');
await import('@luxledger/http/errors');
await import('@luxledger/http/mappers');
await import('@luxledger/http/query/pagination');
await import('@luxledger/http/route-core');
await import('@luxledger/http/route-specs');
await import('@luxledger/http/test/harness');
await import('@luxledger/http/validation-utils');
await import('@luxledger/postgres-adapter');
await import('@luxledger/postgres-adapter/drizzle-config');
await import('@luxledger/postgres-adapter/schema');
await import('@luxledger/fastify-routes');
await import('@luxledger/express-routes');
NODE

node --input-type=commonjs <<'NODE'
require('@luxledger/core');
require('@luxledger/postgres-adapter/schema');
NODE

echo "Packed package smoke test passed."
