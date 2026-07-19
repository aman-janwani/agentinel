import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Resolved } from './resolve.js';

/**
 * Every package a lockfile would install, including transitive ones.
 *
 * This is what closes the `npm ci` hole. Clone a repo whose lockfile already contains malware and
 * run `npm ci`: no package is named on the command line, and the commit happened long ago, so
 * neither the install parser nor the pre-commit hook sees anything. The lockfile is the only place
 * the truth is written down, and it is the fully resolved tree, so reading it gives complete
 * transitive coverage for free.
 */
export function packagesInLockfile(repoRoot: string): Resolved[] {
  const path = join(repoRoot, 'package-lock.json');
  if (!existsSync(path)) {
    return [];
  }

  return packagesInLockText(readFileOrNull(path));
}

export function workingTreeLockfilePackages(repoRoot: string): Resolved[] {
  return packagesInLockfile(repoRoot);
}

/**
 * The packages in the *staged* lockfile, the one about to be committed.
 *
 * This is what gives the pre-commit hook transitive coverage. Someone can add a poisoned dependency
 * whose entry only ever appears in package-lock.json, and the package.json diff would not show it.
 * Reading the staged lockfile directly means the whole resolved tree that is about to land is
 * checked, not just the names that changed in package.json.
 */
export function stagedLockfilePackages(repoRoot: string): Resolved[] {
  let text: string | null = null;
  try {
    // ":path" is git's syntax for the staged (index) copy of a file.
    text = execFileSync('git', ['show', ':package-lock.json'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    // No staged lockfile, which is normal for a commit that does not touch dependencies.
    return [];
  }

  return packagesInLockText(text);
}

function packagesInLockText(text: string | null): Resolved[] {
  if (text === null) {
    return [];
  }

  let lock: unknown;
  try {
    lock = JSON.parse(text);
  } catch {
    return [];
  }

  if (typeof lock !== 'object' || lock === null) {
    return [];
  }

  const found = new Map<string, Resolved>();
  collectFromPackages(lock as Record<string, unknown>, found);
  collectFromDependencies(lock as Record<string, unknown>, found);

  return [...found.values()];
}

function readFileOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Lockfile v2 and v3. Keys look like "node_modules/foo" or "node_modules/a/node_modules/b", and
 * the package name is whatever follows the last "node_modules/".
 */
function collectFromPackages(lock: Record<string, unknown>, found: Map<string, Resolved>): void {
  const packages = lock.packages;
  if (typeof packages !== 'object' || packages === null) {
    return;
  }
  const entries = packages as Record<string, unknown>;

  for (const key of Object.keys(entries)) {
    // The empty key is the project itself, and a link points at a local workspace, not the registry.
    if (key === '') continue;

    const marker = key.lastIndexOf('node_modules/');
    if (marker === -1) continue;

    const name = key.slice(marker + 'node_modules/'.length);
    if (!name) continue;

    const entry = entries[key];
    const version =
      typeof entry === 'object' && entry !== null
        ? String((entry as Record<string, unknown>).version ?? '')
        : '';
    found.set(name, { name, version });
  }
}

/** Lockfile v1, which nests dependencies instead of flattening them. */
function collectFromDependencies(
  lock: Record<string, unknown>,
  found: Map<string, Resolved>,
): void {
  const walk = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return;

    const deps = (node as Record<string, unknown>).dependencies;
    if (typeof deps !== 'object' || deps === null) return;

    for (const [name, child] of Object.entries(deps as Record<string, unknown>)) {
      const version =
        typeof child === 'object' && child !== null
          ? String((child as Record<string, unknown>).version ?? '')
          : '';
      found.set(name, { name, version });
      walk(child);
    }
  };

  walk(lock);
}
