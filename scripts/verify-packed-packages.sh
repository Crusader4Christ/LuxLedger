#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SMOKE_DIR="$ROOT_DIR/.tmp/package-smoke"
TARBALL_DIR="$SMOKE_DIR/tarballs"
NODE_MODULES_DIR="$SMOKE_DIR/node_modules"
SCOPE_DIR="$NODE_MODULES_DIR/@luxledger"

rm -rf "$SMOKE_DIR"
mkdir -p "$TARBALL_DIR" "$SCOPE_DIR"

export npm_config_cache="$ROOT_DIR/.tmp/npm-cache"

pack_workspace() {
  npm pack --workspace "$1" --pack-destination "$TARBALL_DIR" >/dev/null
}

extract_package() {
  local tarball="$1"
  local package_dir="$2"

  mkdir -p "$package_dir"
  tar -xzf "$tarball" -C "$package_dir" --strip-components=1
}

extract_package_by_name() {
  local package_name="$1"
  local package_dir="$2"
  local tarball

  tarball="$(find "$TARBALL_DIR" -maxdepth 1 -name "$package_name-*.tgz" -print -quit)"
  if [[ -z "$tarball" ]]; then
    echo "Missing packed tarball for $package_name" >&2
    exit 1
  fi

  extract_package "$tarball" "$package_dir"
}

link_dependency() {
  local name="$1"
  local target="$ROOT_DIR/node_modules/$name"

  if [[ ! -e "$target" ]]; then
    target="$ROOT_DIR/node_modules/.bun/node_modules/$name"
  fi

  if [[ ! -e "$target" ]]; then
    target="$(find "$ROOT_DIR/packages" -maxdepth 4 -path "*/node_modules/$name" -print -quit)"
  fi

  if [[ -e "$target" && ! -e "$NODE_MODULES_DIR/$name" ]]; then
    ln -s "$target" "$NODE_MODULES_DIR/$name"
  fi
}

pack_workspace "@luxledger/core"
pack_workspace "@luxledger/http"
pack_workspace "@luxledger/postgres-adapter"
pack_workspace "@luxledger/fastify-routes"
pack_workspace "@luxledger/express-routes"

extract_package_by_name "luxledger-core" "$SCOPE_DIR/core"
extract_package_by_name "luxledger-http" "$SCOPE_DIR/http"
extract_package_by_name "luxledger-postgres-adapter" "$SCOPE_DIR/postgres-adapter"
extract_package_by_name "luxledger-fastify-routes" "$SCOPE_DIR/fastify-routes"
extract_package_by_name "luxledger-express-routes" "$SCOPE_DIR/express-routes"

link_dependency "ajv"
link_dependency "ajv-formats"
link_dependency "drizzle-orm"
link_dependency "express"
link_dependency "fastify"
link_dependency "postgres"
link_dependency "safe-stable-stringify"

cd "$SMOKE_DIR"

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
