import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const PUBLIC_PACKAGES = [
  'core',
  'http',
  'postgres-adapter',
  'fastify-routes',
  'express-routes',
] as const;

type PackageManifest = {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
};

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function stateChangingOperations(source: string): string[] {
  const operations: string[] = [];
  let path: string | undefined;

  for (const line of source.split('\n')) {
    const pathMatch = line.match(/^ {2}(\/[^:]+):\s*$/);
    if (pathMatch) {
      path = pathMatch[1];
      continue;
    }

    const methodMatch = line.match(/^ {4}(post|put|patch|delete):\s*$/);
    if (path && methodMatch) operations.push(`${methodMatch[1].toUpperCase()} ${path}`);
  }

  return operations;
}

async function readManifest(root: string, packageDirectory: string): Promise<PackageManifest> {
  return JSON.parse(
    await readFile(join(root, 'packages', packageDirectory, 'package.json'), 'utf8'),
  ) as PackageManifest;
}

function openApiVersion(source: string): string {
  const match = source.match(/^info:\n(?:[ \t].*\n)*?[ \t]+version:[ \t]*([^\s#]+)[ \t]*$/m);
  if (!match) throw new Error('OpenAPI info.version is missing');
  return match[1];
}

export async function verifyReleaseReadiness(root: string): Promise<string> {
  const manifests = await Promise.all(
    PUBLIC_PACKAGES.map((directory) => readManifest(root, directory)),
  );
  const versions = new Set(manifests.map(({ version }) => version));
  if (versions.size !== 1) {
    throw new Error(
      `Public package versions must match: ${manifests.map(({ name, version }) => `${name}@${version}`).join(', ')}`,
    );
  }

  const version = manifests[0].version;
  if (!SEMVER.test(version)) {
    throw new Error(`Public package version must be valid SemVer: ${version}`);
  }
  const expectedRange = `^${version}`;
  for (const manifest of manifests) {
    for (const [dependency, range] of Object.entries(manifest.dependencies ?? {})) {
      if (dependency.startsWith('@luxledger/') && range !== expectedRange) {
        throw new Error(
          `${manifest.name} must depend on ${dependency}@${expectedRange}, received ${range}`,
        );
      }
    }
  }

  const openApiSource = await readFile(join(root, 'packages/http/openapi/openapi.yaml'), 'utf8');
  const contractVersion = openApiVersion(openApiSource);
  if (contractVersion !== version) {
    throw new Error(`OpenAPI version ${contractVersion} must match package version ${version}`);
  }

  const releaseNotesPath = join(root, 'docs', 'releases', `${version}.md`);
  const releaseNotes = await readFile(releaseNotesPath, 'utf8').catch(() => {
    throw new Error(`Release notes are missing: docs/releases/${version}.md`);
  });
  for (const manifest of manifests) {
    if (!releaseNotes.includes(`\`${manifest.name}\` | \`${version}\``)) {
      throw new Error(`Release notes do not declare ${manifest.name}@${version}`);
    }
  }

  const changelog = await readFile(join(root, 'CHANGELOG.md'), 'utf8').catch(() => {
    throw new Error('CHANGELOG.md is missing');
  });
  if (!changelog.includes(`## [${version}]`)) {
    throw new Error(`CHANGELOG.md does not contain a ${version} release heading`);
  }

  const idempotencyReference = await readFile(
    join(root, 'docs', 'integration', 'idempotency.md'),
    'utf8',
  ).catch(() => {
    throw new Error('Idempotency reference is missing: docs/integration/idempotency.md');
  });
  for (const operation of stateChangingOperations(openApiSource)) {
    if (!idempotencyReference.includes(`\`${operation}\``)) {
      throw new Error(`Idempotency reference does not cover ${operation}`);
    }
  }

  return version;
}

if (import.meta.main) {
  const version = await verifyReleaseReadiness(process.cwd());
  console.log(`Release readiness manifest checks passed for ${version}.`);
}
