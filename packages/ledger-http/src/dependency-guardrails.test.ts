import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pkg from '../package.json';

const SRC_DIR = join(import.meta.dir);
const ROOT = join(SRC_DIR, '..');

const forbiddenSpecifiers = [
  'fastify',
  'express',
  '@nestjs/core',
  'drizzle-orm',
  'postgres',
  '@api/',
  'apps/',
];

test('package deps exclude forbidden runtime dependencies', () => {
  const packageJson = pkg as {
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };

  const deps = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.peerDependencies ?? {}),
  };

  for (const forbidden of ['fastify', 'express', '@nestjs/core', 'drizzle-orm', 'postgres']) {
    expect(deps[forbidden]).toBeUndefined();
  }
});

test('source files do not import forbidden modules', () => {
  const files = ['index.ts', 'types.ts', 'errors.ts', 'contracts.ts', 'route-specs.ts'];

  for (const file of files) {
    const content = readFileSync(join(SRC_DIR, file), 'utf8');

    for (const forbidden of forbiddenSpecifiers) {
      expect(content.includes(`from '${forbidden}`)).toBeFalse();
      expect(content.includes(`from "${forbidden}`)).toBeFalse();
    }
  }
});

test('internal module is not exported from package root', () => {
  const indexContent = readFileSync(join(ROOT, 'src/index.ts'), 'utf8');
  expect(indexContent.includes('./internal')).toBeFalse();
});
