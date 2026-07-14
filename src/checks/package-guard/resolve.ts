import { execFileSync } from 'node:child_process';
import { npmCommand } from '../../platform.js';

/** A package the install would bring in, at the exact version it would bring in. */
export interface Resolved {
  name: string;
  version: string;
}

/**
 * Every package an install would actually bring in, including the transitive ones, at the exact
 * version.
 *
 * This is the difference between a toy and a real guard. `npm install express` looks like one
 * package and installs 67. Most real npm malware lives in a transitive dependency, so checking only
 * the name that was typed means checking 1 package out of 67 and calling the result safe.
 *
 * npm will tell us for free, without installing anything: `npm install --dry-run <pkg>` prints an
 * `add <name> <version>` line for every package it would add. That is npm's own resolver, so semver,
 * peer dependencies and workspaces all behave exactly as the real install would. No proxy, and no
 * reimplementation of the resolution algorithm.
 *
 * The version matters. It is what lets the whole tree be checked against the malware list locally,
 * with no network at all, and it is the only way to tell chalk (fine) from the one version of chalk
 * that was compromised.
 */
const TIMEOUT_MS = 20_000;

export function resolveInstall(repoRoot: string, packages: string[]): Resolved[] {
  if (packages.length === 0) {
    return [];
  }

  // On Windows npm is npm.cmd and must go through a shell, otherwise this throws ENOENT and the
  // whole transitive tree is lost, which is exactly the coverage that makes this more than a toy.
  // Package names have already been validated against npm's naming rules before they reach here, so
  // there are no shell metacharacters to worry about even when a shell is involved.
  const npm = npmCommand();

  let output: string;
  try {
    output = execFileSync(
      npm.file,
      ['install', '--dry-run', '--no-audit', '--no-fund', ...packages],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        timeout: TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'ignore'],
        shell: npm.shell,
        env: { ...process.env, NO_COLOR: '1' },
      },
    );
  } catch (error) {
    // npm fails when a package does not exist, which is a real answer rather than a reason to give
    // up. The named packages are checked over the network anyway, so falling back here loses the
    // transitive tree but never loses the warning that matters most.
    const stdout = (error as { stdout?: string }).stdout;
    output = typeof stdout === 'string' ? stdout : '';
  }

  return parseAddLines(output);
}

/** npm prints one `add <name> <version>` line per package it would install. */
export function parseAddLines(output: string): Resolved[] {
  const found = new Map<string, Resolved>();

  for (const line of output.split('\n')) {
    const match = /^add\s+(\S+)\s+(\S+)/.exec(line.trim());
    if (match?.[1] && match[2]) {
      found.set(match[1], { name: match[1], version: match[2] });
    }
  }

  return [...found.values()];
}
