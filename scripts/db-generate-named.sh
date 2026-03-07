#!/usr/bin/env bash
set -euo pipefail

print_help() {
  echo "Usage: bun run db:generate -- <short-description>"
  echo "Example: bun run db:generate -- add-account-side"
  echo "Result: 0001_YYYY-MM-DD-add-account-side.sql"
}

if [ "$#" -eq 1 ] && { [ "$1" = "-h" ] || [ "$1" = "--help" ]; }; then
  print_help
  exit 0
fi

if [ "$#" -lt 1 ]; then
  print_help
  exit 1
fi

raw_slug="$*"
slug="$(printf '%s' "$raw_slug" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g; s/-+/-/g')"

if [ -z "$slug" ]; then
  echo "Error: migration slug is empty after normalization"
  exit 1
fi

name="$(date +%Y-%m-%d)-$slug"
echo "Generating migration: $name"

bunx drizzle-kit generate --name "$name"
