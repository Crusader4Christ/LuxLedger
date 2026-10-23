"""Workflow regression checks using an isolated real Git repository."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

from agent_tools import changed_files, instructions, verification


class WorkflowTests(unittest.TestCase):
    def test_inventory_includes_branch_index_worktree_and_untracked(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def git(*args):
                return subprocess.check_output(['git', '-C', directory, *args], stderr=subprocess.DEVNULL)
            git('init', '-q')
            git('config', 'user.email', 'fixture@example.invalid')
            git('config', 'user.name', 'Fixture')
            for name in ('AGENTS.md', 'a.md', 'b.md'):
                (root / name).write_text('initial\n')
            git('add', '.')
            git('commit', '-qm', 'base')
            base = git('rev-parse', 'HEAD').decode().strip()
            (root / 'a.md').write_text('branch\n')
            git('commit', '-qam', 'branch')
            (root / 'b.md').write_text('staged\n')
            git('add', 'b.md')
            # Reversing only the worktree must not hide the staged change.
            (root / 'b.md').write_text('initial\n')
            # A local reversal must not hide a committed branch change either.
            (root / 'a.md').write_text('initial\n')
            (root / 'space name.md').write_text('new\n')
            package = root / 'packages/core'
            package.mkdir(parents=True)
            (package / 'AGENTS.md').write_text('local\n')
            (package / 'new.ts').write_text('')
            baseline, files = changed_files(root, base)
            self.assertEqual(baseline, base)
            self.assertTrue({'a.md', 'b.md', 'space name.md', 'packages/core/new.ts'} <= set(files))
            self.assertEqual(instructions(root, files), ['AGENTS.md', 'packages/core/AGENTS.md'])
            self.assertIn('b.md', changed_files(root, None)[1])
            (root / 'a.md').write_text('branch\n')
            self.assertNotIn('a.md', changed_files(root, None)[1])

    def test_docs_do_not_trigger_runtime_checks(self):
        self.assertTrue(all(command[:3] == ['git', 'diff', '--check']
                            for command in verification(['packages/core/AGENTS.md'])))

    def test_explicit_flags_apply_without_code_changes(self):
        for files in ([], ['AGENTS.md']):
            with self.subTest(files=files):
                full = verification(files, full=True)
                self.assertIn(['bun', 'run', 'test:unit'], full)
                self.assertIn(['bun', 'run', 'test:integration'], full)
                public = verification(files, public=True)
                self.assertIn(['bun', 'run', 'build:packages'], public)
                self.assertIn(['bun', 'run', 'pack:verify'], public)

    def test_whitespace_gates_detect_committed_staged_and_unstaged_errors(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            def git(*args):
                return subprocess.check_output(['git', '-C', directory, *args], stderr=subprocess.DEVNULL)
            git('init', '-q')
            git('config', 'user.email', 'fixture@example.invalid')
            git('config', 'user.name', 'Fixture')
            git('config', 'core.whitespace', 'blank-at-eol')
            (root / 'doc.md').write_text('initial\n')
            git('add', '.')
            git('commit', '-qm', 'base')
            base = git('rev-parse', 'HEAD').decode().strip()
            checks = verification(['doc.md'], baseline=base)
            for stage in ('unstaged', 'staged', 'branch'):
                if stage == 'unstaged':
                    (root / 'doc.md').write_text('trailing space \n')
                elif stage == 'staged':
                    git('add', 'doc.md')
                else:
                    git('commit', '-qm', 'branch')
                with self.subTest(stage=stage):
                    results = [subprocess.run(command, cwd=root, capture_output=True).returncode
                               for command in checks]
                    self.assertIn(2, results)

    def test_persistence_and_schema_require_database_gates(self):
        commands = verification(['packages/postgres-adapter/src/schema.ts'])
        for script in ('test:integration', 'migration:verify', 'test:unit'):
            self.assertIn(['bun', 'run', script], commands)

    def test_route_and_semantic_export_gates(self):
        commands = verification(['packages/express-routes/src/route.ts'], public=True)
        self.assertIn(['bun', 'run', 'contract:verify'], commands)
        self.assertIn(['bun', 'test', 'packages/express-routes/src/parity.test.ts'], commands)
        self.assertIn(['bun', 'run', 'pack:verify'], commands)

    def test_configuration_is_not_classified_as_docs(self):
        self.assertIn(['bun', 'run', 'lint'], verification(['.github/workflows/ci.yml']))

    def test_compact_excerpt_is_bounded_and_keeps_error(self):
        spec = importlib.util.spec_from_file_location('compact', Path(__file__).with_name('run_compact.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        excerpt = module.select_excerpt(['ok'] * 100 + ['ERROR: fixture'] + ['ok'] * 100, 2, 2, 10)
        self.assertLessEqual(len(excerpt), 10)
        self.assertIn('ERROR: fixture', excerpt)


if __name__ == '__main__':
    unittest.main()
