import { expect, test } from 'bun:test';
import pkg from '../package.json';

test('has no framework runtime dependencies', () => {
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
