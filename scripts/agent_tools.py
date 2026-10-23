#!/usr/bin/env python3
"""Small shared workflow helpers; run from any directory inside the repository."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import shlex
import subprocess
import sys


BOUNDARY_TESTS = [
    'packages/http/src/test/boundaries.test.ts',
    'packages/http/src/test/dependency-guardrails.test.ts',
    'packages/http/src/test/public-api.test.ts',
]


def git(root: Path, *args: str) -> str:
    return subprocess.check_output(['git', '-C', str(root), *args], text=True).strip('\n')


def diff_scopes(baseline: str | None = None) -> dict[str, list[str]]:
    scopes = {'branch': [baseline, 'HEAD']} if baseline else {}
    scopes.update({'staged': ['--cached', 'HEAD'], 'unstaged': []})
    return scopes


def changed_files(root: Path, base: str | None) -> tuple[str, list[str]]:
    baseline = git(root, 'merge-base', base, 'HEAD') if base else git(root, 'rev-parse', 'HEAD')
    paths = set()
    for scope in diff_scopes(baseline).values():
        paths.update(git(root, 'diff', '--name-only', '--no-renames', '-z', *scope, '--').split('\0'))
    paths.update(git(root, 'ls-files', '--others', '--exclude-standard', '-z').split('\0'))
    return baseline, sorted(paths - {''})


def instructions(root: Path, files: list[str]) -> list[str]:
    found = {'AGENTS.md'} if (root / 'AGENTS.md').is_file() else set()
    for name in files:
        for parent in (root / name).parent.parents:
            if parent == root or root not in parent.parents:
                break
            candidate = parent / 'AGENTS.md'
            if candidate.is_file():
                found.add(candidate.relative_to(root).as_posix())
        candidate = (root / name).parent / 'AGENTS.md'
        if candidate.is_file():
            found.add(candidate.relative_to(root).as_posix())
    return sorted(found)


def verification(files: list[str], full: bool = False, public: bool = False,
                 baseline: str | None = None) -> list[list[str]]:
    commands = [['git', 'diff', '--check', *scope, '--'] for scope in diff_scopes(baseline).values()]
    docs_only = all(p.endswith(('.md', '.yaml')) and
                    (p.endswith('.md') or p.startswith('.agents/')) for p in files)
    if (not files or docs_only) and not (full or public):
        return commands
    commands += [['bun', 'run', name] for name in ('lint', 'typecheck', 'test:unit')]
    if any(p.endswith('.py') for p in files):
        commands.append(['python3', '-B', '-m', 'unittest', 'discover', '-s', 'scripts', '-p', 'test_*.py'])
    if any(p.startswith('scripts/') and p.endswith('.ts') for p in files):
        commands.append(['bun', 'run', 'typecheck:test'])
    persistence = any(p.startswith(('packages/postgres-adapter/', 'drizzle/')) and not p.endswith('.md')
                      for p in files)
    if full or persistence:
        commands.append(['bun', 'run', 'test:integration'])
    if any(p.startswith('drizzle/') or p == 'packages/postgres-adapter/src/schema.ts' for p in files):
        commands.append(['bun', 'run', 'migration:verify'])
    if any(p.startswith(('packages/http/', 'packages/express-routes/', 'packages/fastify-routes/'))
           and not p.endswith('.md') for p in files):
        commands.append(['bun', 'run', 'contract:verify'])
    if any(p.startswith(('packages/express-routes/', 'packages/fastify-routes/')) and not p.endswith('.md')
           for p in files):
        commands.append(['bun', 'test', 'packages/express-routes/src/parity.test.ts'])
    artifact = public or any(p.endswith(('package.json', 'index.ts')) or 'tsconfig' in p or
                             '/build' in p or p == 'bun.lock' for p in files)
    if artifact:
        commands += [['bun', 'run', name] for name in ('build:packages', 'release:verify', 'pack:verify')]
    return commands


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['task-context', 'verify-change', 'check-boundaries', 'pr-context'])
    parser.add_argument('--base', help='Intended target ref; uses merge base plus staged/unstaged/untracked changes')
    parser.add_argument('--full', action='store_true', help='Require code gates and integration even with no code diff')
    parser.add_argument('--public', action='store_true', help='Include checks for semantic public API/artifact changes')
    parser.add_argument('--run', action='store_true', help='Execute gates sequentially with compact output')
    parser.add_argument('--database-target-verified', action='store_true',
                        help='Assert that the effective disposable database target has been independently verified')
    args = parser.parse_args()
    root = Path(subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], text=True).strip())
    baseline, files = changed_files(root, args.base)
    commands = verification(files, args.full, args.public, baseline)
    if args.mode == 'check-boundaries':
        print('Existing HTTP dependency/public API guardrails only; other package boundaries require review.', flush=True)
        commands = [['bun', 'test', *BOUNDARY_TESTS]]
    if args.mode in ('task-context', 'pr-context'):
        payload = {'branch': git(root, 'branch', '--show-current'), 'head': git(root, 'rev-parse', 'HEAD'),
                   'baseline': baseline, 'files': files,
                   'packages': sorted({p.split('/')[1] for p in files if p.startswith('packages/')}),
                   'instructions': instructions(root, files)}
        if args.mode == 'pr-context':
            payload['diffstat'] = {
                name: stat for name, scope in diff_scopes(baseline).items()
                if (stat := git(root, 'diff', '--stat', *scope, '--'))
            }
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        return 0
    print('Suggested gates; check semantic scope and local instructions. No cached results are assumed.', flush=True)
    for command in commands:
        print(shlex.join(command), flush=True)
    if not args.run:
        return 0
    database = any(cmd[-1] in ('test:integration', 'migration:verify') for cmd in commands)
    if database and not args.database_target_verified:
        parser.error('Verify the effective disposable database target first, then use --database-target-verified.')
    for command in commands:
        code = subprocess.call([sys.executable, str(root / 'scripts/run_compact.py'), '--', *command], cwd=root)
        if code:
            return code
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except subprocess.CalledProcessError as error:
        sys.exit(error.returncode)
