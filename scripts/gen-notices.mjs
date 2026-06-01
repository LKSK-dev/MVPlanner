#!/usr/bin/env node
/**
 * Generate MVPlanner's bundled third-party license notices.
 *
 * The shipped single-file app bundles only runtime dependencies. This script
 * starts at package.json `dependencies`, resolves the packages that are
 * actually present in node_modules, walks their runtime dependency edges, and
 * emits both the root NOTICES file and a TypeScript string asset consumed by the
 * About panel.
 */
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');
const NOTICES_PATH = path.join(PROJECT_ROOT, 'NOTICES');
const GENERATED_TS_PATH = path.join(
  PROJECT_ROOT,
  'src',
  'ui',
  'shell',
  'about',
  'notices.generated.ts',
);

/** @typedef {{ name: string, version: string, license: string, path: string, licenseFiles: readonly LicenseFile[] }} NoticePackage */
/** @typedef {{ name: string, text: string }} LicenseFile */

/** True when a value is a non-array object. */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read and parse JSON from disk. */
async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

/** Return a string property from an object, or undefined when absent/malformed. */
function stringProp(record, key) {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

/** Normalize an npm package name into node_modules path segments. */
function packageSegments(name) {
  return name.split('/');
}

/** Resolve `name` as Node would from `issuerDir`, constrained to installed packages. */
function resolvePackageDir(name, issuerDir) {
  let dir = issuerDir;
  const segments = packageSegments(name);
  for (;;) {
    const candidate = path.join(dir, 'node_modules', ...segments, 'package.json');
    if (existsSync(candidate)) return path.dirname(candidate);
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Convert an absolute package directory to a package-lock key. */
function lockKeyForPackageDir(projectRoot, packageDir) {
  return path.relative(projectRoot, packageDir).split(path.sep).join('/');
}

/** Return true when package-lock marks the package as a dev-only package. */
function isDevOnlyPackage(lock, projectRoot, packageDir) {
  if (!isRecord(lock.packages)) return false;
  const entry = lock.packages[lockKeyForPackageDir(projectRoot, packageDir)];
  return isRecord(entry) && entry.dev === true;
}

/** Extract dependency names from a package.json object in deterministic order. */
function runtimeDependencyNames(pkg) {
  const names = new Set();
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    const deps = pkg[field];
    if (!isRecord(deps)) continue;
    for (const name of Object.keys(deps)) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** Normalize package.json license metadata. */
function normalizeLicense(pkg) {
  const license = pkg.license;
  if (typeof license === 'string' && license.trim().length > 0) return license.trim();
  if (isRecord(license)) {
    const type = stringProp(license, 'type');
    if (type !== undefined && type.trim().length > 0) return type.trim();
  }
  const licenses = pkg.licenses;
  if (Array.isArray(licenses)) {
    const parts = licenses
      .map((item) => {
        if (typeof item === 'string') return item;
        if (isRecord(item)) return stringProp(item, 'type') ?? '';
        return '';
      })
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (parts.length > 0) return parts.join(' OR ');
  }
  return 'UNKNOWN';
}

/** Stable rank for common license/notice filenames. */
function licenseFileRank(name) {
  const upper = name.toUpperCase();
  if (upper.startsWith('LICENSE')) return 0;
  if (upper.startsWith('LICENCE')) return 1;
  if (upper.startsWith('COPYING')) return 2;
  if (upper.startsWith('NOTICE')) return 3;
  return 4;
}

/** Find and read license/notice text files from a package directory. */
async function readLicenseFiles(packageDir) {
  const entries = await readdir(packageDir, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /^(licen[cs]e|copying|notice)(\b|[._-])/i.test(name))
    .sort((a, b) => licenseFileRank(a) - licenseFileRank(b) || a.localeCompare(b));

  const files = [];
  for (const name of names) {
    const text = (await readFile(path.join(packageDir, name), 'utf8'))
      .replace(/\r\n?/g, '\n')
      .trimEnd();
    if (text.length > 0) files.push({ name, text });
  }
  return files;
}

/** Sort package records by package name and then version. */
function compareNoticePackages(a, b) {
  return a.name.localeCompare(b.name) || a.version.localeCompare(b.version);
}

/** Build the runtime package inventory from installed production dependencies. */
export async function collectRuntimePackages(projectRoot = PROJECT_ROOT) {
  const rootPkg = await readJson(path.join(projectRoot, 'package.json'));
  const lockPath = path.join(projectRoot, 'package-lock.json');
  const lock = existsSync(lockPath) ? await readJson(lockPath) : {};
  const rootDeps = isRecord(rootPkg.dependencies) ? Object.keys(rootPkg.dependencies).sort() : [];

  const queue = rootDeps.map((name) => ({ name, issuerDir: projectRoot }));
  const seenDirs = new Set();
  const packages = new Map();

  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined) break;

    const packageDir = resolvePackageDir(next.name, next.issuerDir);
    if (packageDir === undefined) continue;
    const realKey = path.resolve(packageDir);
    if (seenDirs.has(realKey)) continue;
    seenDirs.add(realKey);
    if (isDevOnlyPackage(lock, projectRoot, packageDir)) continue;

    const pkg = await readJson(path.join(packageDir, 'package.json'));
    if (!isRecord(pkg)) continue;
    const packageName = stringProp(pkg, 'name') ?? next.name;
    const version = stringProp(pkg, 'version') ?? '0.0.0-unknown';
    const key = `${packageName}@${version}`;
    if (!packages.has(key)) {
      packages.set(key, {
        name: packageName,
        version,
        license: normalizeLicense(pkg),
        path: lockKeyForPackageDir(projectRoot, packageDir),
        licenseFiles: await readLicenseFiles(packageDir),
      });
    }

    for (const depName of runtimeDependencyNames(pkg)) {
      const depDir = resolvePackageDir(depName, packageDir);
      if (depDir === undefined) continue;
      if (isDevOnlyPackage(lock, projectRoot, depDir)) continue;
      queue.push({ name: depName, issuerDir: packageDir });
    }
  }

  return [...packages.values()].sort(compareNoticePackages);
}

/** Render root NOTICES content. */
export function renderNotices(packages) {
  const lines = [
    'MVPlanner Third-Party Notices',
    '================================',
    '',
    'This file is generated by `node scripts/gen-notices.mjs`.',
    'It lists runtime npm dependencies bundled into the single-file application; development-only dependencies are excluded.',
    '',
    `Package count: ${packages.length}`,
    '',
  ];

  for (const pkg of packages) {
    lines.push(
      '---',
      '',
      `${pkg.name}@${pkg.version}`,
      `License: ${pkg.license}`,
      `Installed path: ${pkg.path}`,
    );
    if (pkg.licenseFiles.length === 0) {
      lines.push('', 'License text: not found in package.');
      continue;
    }
    for (const file of pkg.licenseFiles) {
      lines.push('', `License text from ${file.name}:`, '', file.text, '');
    }
  }

  return `${lines
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .trimEnd()}\n`;
}

/** Escape text for a generated String.raw template literal. */
function rawTemplateText(text) {
  return text.replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

/** Render the bundled notices string TypeScript asset. */
export function renderNoticesTypeScript(notices) {
  return `/**\n * Bundled third-party notices for the About → Licenses viewer.\n *\n * Generated by scripts/gen-notices.mjs; do not edit by hand.\n */\nexport const NOTICES_TEXT = String.raw\`${rawTemplateText(notices)}\`;\n`;
}

/** Generate and write NOTICES plus the bundled TypeScript notices asset. */
export async function generateNotices(projectRoot = PROJECT_ROOT) {
  const packages = await collectRuntimePackages(projectRoot);
  const notices = renderNotices(packages);
  await writeFile(path.join(projectRoot, 'NOTICES'), notices, 'utf8');
  await writeFile(
    path.join(projectRoot, 'src', 'ui', 'shell', 'about', 'notices.generated.ts'),
    renderNoticesTypeScript(notices),
    'utf8',
  );
  return { packages, notices };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { packages } = await generateNotices(PROJECT_ROOT);
  console.log(`Generated NOTICES for ${packages.length} runtime packages.`);
  console.log(path.relative(PROJECT_ROOT, NOTICES_PATH));
  console.log(path.relative(PROJECT_ROOT, GENERATED_TS_PATH));
}
