#!/usr/bin/env sh
set -eu

test_files=$(
  find apps packages -type f -name '*.test.ts' \
    \( -path '*/integration/*' -o -name '*.integration.test.ts' \) \
    | sort
)

if [ -z "$test_files" ]; then
  echo "No integration tests found." >&2
  exit 1
fi

bun test --max-concurrency=1 $test_files
