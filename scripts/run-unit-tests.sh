#!/usr/bin/env sh
set -eu

test_files=$(
  find apps packages -type f -name '*.test.ts' \
    ! -path '*/integration/*' \
    ! -name '*.integration.test.ts' \
    | sort
)

if [ -z "$test_files" ]; then
  echo "No unit tests found." >&2
  exit 1
fi

bun test $test_files
