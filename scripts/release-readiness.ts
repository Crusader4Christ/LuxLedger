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

  const contractVersion = openApiVersion(
    await readFile(join(root, 'packages/http/openapi/openapi.yaml'), 'utf8'),
  );
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

  return version;
}

if (import.meta.main) {
  const version = await verifyReleaseReadiness(process.cwd());
  console.log(`Release readiness manifest checks passed for ${version}.`);
}
