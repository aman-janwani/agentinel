import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;

/**
 * Package names added to any staged package.json, compared against HEAD.
 *
 * Every staged package.json is checked, not just the one at the repo root, so a dependency added
 * to a workspace package in a monorepo is caught too. Only additions matter. A version bump on a
 * package that was already there is not a new package.
 */
export function newStagedDependencies(repoRoot: string): string[] {
  const names: string[] = [];

  for (const path of changedManifestPaths(repoRoot, [
    'diff',
    '--cached',
    '--name-only',
    '-z',
    '--diff-filter=ACMR',
  ])) {
    const staged = gitJson(repoRoot, `:${path}`);
    if (!staged) continue;

    const before = collectNames(gitJson(repoRoot, `HEAD:${path}`) ?? {});
    for (const name of collectNames(staged)) {
      if (!before.has(name) && !names.includes(name)) names.push(name);
    }
  }

  return names;
}

export function newWorkingTreeDependencies(repoRoot: string): string[] {
  const names: string[] = [];

  for (const path of changedManifestPaths(repoRoot, [
    'diff',
    'HEAD',
    '--name-only',
    '-z',
    '--diff-filter=ACMR',
  ])) {
    let onDisk: Record<string, unknown> | null = null;
    try {
      onDisk = JSON.parse(readFileSync(join(repoRoot, path), 'utf8'));
    } catch {
      continue;
    }
    if (!onDisk) continue;

    const before = collectNames(gitJson(repoRoot, `HEAD:${path}`) ?? {});
    for (const name of collectNames(onDisk)) {
      if (!before.has(name) && !names.includes(name)) names.push(name);
    }
  }

  return names;
}

/**
 * The package.json files touched by the staged changes, as repo relative paths.
 *
 * `-z` matters. Without it git escapes any path that is not plain ASCII and wraps it in quotes,
 * so `packages/café/package.json` comes back as `"packages/caf\303\251/package.json"` and every
 * later git command on that path fails. The dependency then goes unchecked, silently. NUL
 * separated output is given raw.
 */
function changedManifestPaths(repoRoot: string, gitArgs: string[]): string[] {
  const output = git(repoRoot, gitArgs);
  if (output === null) {
    return [];
  }

  return output
    .split('\0')
    .filter((path) => path === 'package.json' || path.endsWith('/package.json'))
    .filter((path) => !isInsideDependencies(path));
}

/**
 * A package.json inside node_modules belongs to an installed dependency, not to this project. Some
 * repos commit node_modules, and scanning those would warn about transitive dependencies nobody
 * chose, and fire hundreds of requests at npm while doing it.
 */
function isInsideDependencies(path: string): boolean {
  return path.split('/').includes('node_modules');
}

export function repoRootOrCwd(): string {
  const root = git(process.cwd(), ['rev-parse', '--show-toplevel']);
  return root === null ? process.cwd() : root.trim();
}

function collectNames(manifest: Record<string, unknown>): Set<string> {
  const names = new Set<string>();

  for (const field of DEP_FIELDS) {
    const section = manifest[field];
    if (typeof section === 'object' && section !== null) {
      for (const name of Object.keys(section)) {
        names.add(name);
      }
    }
  }

  return names;
}

/** Reads a JSON file at a git revision. Missing is normal, for example on the first commit. */
function gitJson(repoRoot: string, revision: string): Record<string, unknown> | null {
  const text = git(repoRoot, ['show', revision]);
  if (text === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}
