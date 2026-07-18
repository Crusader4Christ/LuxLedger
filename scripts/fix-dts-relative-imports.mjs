import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const distDir = process.argv[2];

if (!distDir) {
  console.error('Usage: node scripts/fix-dts-relative-imports.mjs <dist-dir>');
  process.exit(1);
}

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const absoluteDistDir = join(rootDir, distDir);

const hasKnownExtension = (specifier) =>
  /\.[cm]?[jt]sx?$/.test(specifier) || specifier.endsWith('.json');

const toPosixPath = (path) => path.split(sep).join('/');

const pathExists = async (path) => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const resolveDtsSpecifier = async (sourceFile, specifier) => {
  if (!specifier.startsWith('.') || hasKnownExtension(specifier)) {
    return specifier;
  }

  const sourceDir = dirname(sourceFile);
  const targetPath = join(sourceDir, specifier);

  if (await pathExists(`${targetPath}.d.ts`)) {
    return `${specifier}.js`;
  }

  if (await pathExists(join(targetPath, 'index.d.ts'))) {
    return `${specifier}/index.js`;
  }

  return specifier;
};

const walkDtsFiles = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkDtsFiles(path)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.d.ts')) {
      files.push(path);
    }
  }

  return files;
};

const updateDtsFile = async (file) => {
  const source = await readFile(file, 'utf8');
  const importRegex = /((?:from|import)\s+['"])(\.{1,2}\/[^'"]+)(['"])/g;
  const replacements = [];

  for (const match of source.matchAll(importRegex)) {
    const [, prefix, specifier, suffix] = match;
    const resolved = await resolveDtsSpecifier(file, specifier);
    if (resolved !== specifier) {
      replacements.push({
        start: match.index,
        end: match.index + match[0].length,
        value: `${prefix}${resolved}${suffix}`,
      });
    }
  }

  if (replacements.length === 0) {
    return;
  }

  let output = source;
  for (const replacement of replacements.reverse()) {
    output = `${output.slice(0, replacement.start)}${replacement.value}${output.slice(
      replacement.end,
    )}`;
  }

  await writeFile(file, output);
  console.log(`Updated ${toPosixPath(relative(rootDir, file))}`);
};

const files = await walkDtsFiles(absoluteDistDir);

for (const file of files) {
  await updateDtsFile(file);
}
