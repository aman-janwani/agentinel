import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every package a lockfile would install, including transitive ones.
 *
 * This is what closes the `npm ci` hole. Clone a repo whose lockfile already contains malware and
 * run `npm ci`: no package is named on the command line, and the commit happened long ago, so
 * neither the install parser nor the pre-commit hook sees anything. The lockfile is the only place
 * the truth is written down, and it is the fully resolved tree, so reading it gives complete
 * transitive coverage for free.
 */
export function packagesInLockfile(repoRoot: string): string[] {
  const path = join(repoRoot, 'package-lock.json');
  if (!existsSync(path)) {
    return [];
  }

  let lock: unknown;
  try {
    lock = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return [];
  }

  if (typeof lock !== 'object' || lock === null) {
    return [];
  }

  const names = new Set<string>();
  collectFromPackages(lock as Record<string, unknown>, names);
  collectFromDependencies(lock as Record<string, unknown>, names);

  return [...names];
}

/**
 * Lockfile v2 and v3. Keys look like "node_modules/foo" or "node_modules/a/node_modules/b", and
 * the package name is whatever follows the last "node_modules/".
 */
function collectFromPackages(lock: Record<string, unknown>, names: Set<string>): void {
  const packages = lock.packages;
  if (typeof packages !== 'object' || packages === null) {
    return;
  }

  for (const key of Object.keys(packages)) {
    // The empty key is the project itself, and a link points at a local workspace, not the registry.
    if (key === '') continue;

    const marker = key.lastIndexOf('node_modules/');
    if (marker === -1) continue;

    const name = key.slice(marker + 'node_modules/'.length);
    if (name) names.add(name);
  }
}

/** Lockfile v1, which nests dependencies instead of flattening them. */
function collectFromDependencies(lock: Record<string, unknown>, names: Set<string>): void {
  const walk = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return;

    const deps = (node as Record<string, unknown>).dependencies;
    if (typeof deps !== 'object' || deps === null) return;

    for (const [name, child] of Object.entries(deps as Record<string, unknown>)) {
      names.add(name);
      walk(child);
    }
  };

  walk(lock);
}
