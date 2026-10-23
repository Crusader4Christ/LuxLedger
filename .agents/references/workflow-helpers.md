# Shared workflow helpers

Use when they save repeated work. Run from the repository root with Python 3 (standard library only).

| Command | Result |
| --- | --- |
| `python3 scripts/agent_tools.py task-context [--base REF]` | Branch/head, changed files, applicable instruction paths |
| `python3 scripts/agent_tools.py verify-change [--base REF]` | Suggested gates; add `--run` to execute sequentially, stopping on failure |
| `python3 scripts/agent_tools.py check-boundaries --run` | Existing HTTP dependency/public API guardrails only |
| `python3 scripts/agent_tools.py pr-context [--base REF]` | Inventory and separate branch/staged/unstaged diffstats |
| `python3 scripts/run_compact.py -- COMMAND` | Compact success or bounded failure excerpt; failure log in OS temp |

- `--base` selects the merge base with HEAD; omit for uncommitted work. Refs are not fetched.
  Inventory unions branch, staged, unstaged, and non-ignored untracked paths, preserving reversals.
  Whitespace checks cover each tracked scope; Git diffstats/checks exclude untracked contents.
- Read applicable instructions and inspect semantic scope. Filename routing cannot prove acceptance
  coverage. `--full` forces code gates plus integration; `--public` forces code and artifact gates,
  even on clean/docs-only trees. Neither flag substitutes for all applicable CI/governance checks.
- Before database gates, independently verify the effective disposable target, then supply
  `--database-target-verified`. This flag records your check; it does not validate the database.
  Preserve guards and run shared-database suites sequentially.
- Boundary checks cover HTTP only; inspect other package boundaries manually. PR inventory supplies
  no verification verdict: report actual results for the reviewed revision. No helper caches passes.
- Successful logs are deleted; inspect retained failure logs selectively. Avoid commands containing
  secrets. Helpers do not stage, commit, publish, or update external systems.
