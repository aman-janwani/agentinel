import { execFileSync } from 'node:child_process';

const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;

/**
 * Package names added to package.json in the staged changes, compared against HEAD.
 * Only additions matter. A version bump on a package that was already there is not a new
 * package and is not our problem.
 */
export function newStagedDependencies(repoRoot: string): string[] {
  const staged = readStaged(repoRoot);
  if (!staged) {
    return [];
  }

  const committed = readFromHead(repoRoot) ?? {};
  const before = collectNames(committed);
  const after = collectNames(staged);

  return [...after].filter((name) => !before.has(name));
}

export function repoRootOrCwd(): string {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return process.cwd();
  }
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

function readStaged(repoRoot: string): Record<string, unknown> | null {
  // ":package.json" is git's syntax for the staged (index) version of the file.
  return gitJson(repoRoot, ':package.json');
}

function readFromHead(repoRoot: string): Record<string, unknown> | null {
  // Missing on the very first commit, which is a normal case, not an error.
  return gitJson(repoRoot, 'HEAD:package.json');
}

function gitJson(repoRoot: string, revision: string): Record<string, unknown> | null {
  let text: string;
  try {
    text = execFileSync('git', ['show', revision], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
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
