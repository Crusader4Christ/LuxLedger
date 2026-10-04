import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyReleaseReadiness } from './release-readiness';

const roots: string[] = [];
const packages = ['core', 'http', 'postgres-adapter', 'fastify-routes', 'express-routes'];

async function fixture(
  overrides: {
    packageVersion?: string;
    dependencyRange?: string;
    openApiVersion?: string;
    releaseVersion?: string;
  } = {},
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'luxledger-release-readiness-'));
  roots.push(root);
  const version = overrides.packageVersion ?? '1.2.3';
  for (const name of packages) {
    await mkdir(join(root, 'packages', name), { recursive: true });
    await writeFile(
      join(root, 'packages', name, 'package.json'),
      JSON.stringify({
        name: `@luxledger/${name}`,
        version,
        dependencies:
          name === 'http' ? { '@luxledger/core': overrides.dependencyRange ?? `^${version}` } : {},
      }),
    );
  }
  await mkdir(join(root, 'packages/http/openapi'), { recursive: true });
  await writeFile(
    join(root, 'packages/http/openapi/openapi.yaml'),
    `openapi: 3.1.0\ninfo:\n  title: LuxLedger\n  version: ${overrides.openApiVersion ?? version}\n`,
  );
  const releaseVersion = overrides.releaseVersion ?? version;
  await mkdir(join(root, 'docs/releases'), { recursive: true });
  await writeFile(
    join(root, 'docs/releases', `${version}.md`),
    packages.map((name) => `| \`@luxledger/${name}\` | \`${releaseVersion}\` |`).join('\n'),
  );
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('release readiness', () => {
  it('accepts one coordinated public release set', async () => {
    await expect(verifyReleaseReadiness(await fixture())).resolves.toBe('1.2.3');
  });

  it('rejects an incompatible internal package range', async () => {
    await expect(
      verifyReleaseReadiness(await fixture({ dependencyRange: '^1.2.2' })),
    ).rejects.toThrow('must depend on @luxledger/core@^1.2.3');
  });

  it('rejects OpenAPI version drift', async () => {
    await expect(
      verifyReleaseReadiness(await fixture({ openApiVersion: '1.2.2' })),
    ).rejects.toThrow('OpenAPI version 1.2.2 must match package version 1.2.3');
  });

  it('rejects release-note version drift', async () => {
    await expect(
      verifyReleaseReadiness(await fixture({ releaseVersion: '1.2.2' })),
    ).rejects.toThrow('Release notes do not declare @luxledger/core@1.2.3');
  });
});
