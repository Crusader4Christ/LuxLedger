# Script Instructions

- Reuse existing package commands and database guards; avoid duplicating business rules in tooling.
- Shared agent helpers use Python 3 standard library only. Keep role decisions in the existing skills.
- Inventory must include staged, unstaged, and relevant untracked changes; branch work uses an explicit
  merge base. Never silently fetch refs, stage files, or publish artifacts from read-only helpers.
- Filename-based verification plans are suggestions. Label coverage limits and require explicit
  independent disposable-target verification before executing destructive database checks.
- Run `python3 -B -m unittest discover -s scripts -p 'test_*.py'` for Python helper changes, plus the
  root code-change gates. For TypeScript scripts use `bun run typecheck:test` as applicable.
- Compact command output must retain failure status and enough evidence to locate full temporary logs.
