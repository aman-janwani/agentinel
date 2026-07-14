// The PATH shim, an opt in way to check installs that never go through an agent hook.
//
// The Claude Code hook only fires on a tool call. A person typing `npm i left-pad` in their own
// terminal, an agent with no hook installed, or anything run through `sh -c` all reach the registry
// without us seeing it. The shim closes that by putting a small script named `npm` (and pnpm, yarn,
// bun, npx) earlier on PATH than the real one.
//
// Two rules govern everything in this file:
//
// 1. The shim must never recurse into itself. It finds the real binary by taking its own directory
//    out of PATH and resolving again.
// 2. The shim must fail open. If agentinel is missing, out of date, broken, or throws, the real
//    command still runs. Breaking someone's `npm` is far worse than missing one check.

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { checkPackages } from '../checks/package-guard/evaluate.js';
import { parseCommand } from '../checks/package-guard/parse-install.js';
import { repoRootOrCwd } from '../checks/package-guard/staged-deps.js';
import { loadConfig } from '../config/load.js';
import { denyReason, formatVerdict } from '../output/format.js';
import { isRisky } from '../types.js';

/** The clients we shim. All of them install from the npm registry, so one script covers each. */
const CLIENTS = ['npm', 'npx', 'pnpm', 'yarn', 'bun'];

/**
 * What `check-command` exits with when it decides the command should not run.
 *
 * Deliberately not 1. The shim has to tell "agentinel says stop" apart from "agentinel fell over",
 * and every failure mode of a Node CLI (a crash, an older asen that has never heard of
 * `check-command`, a bad config file) exits 1. If 1 meant stop, any of those would break npm for
 * the user, which is the one thing this must never do.
 */
export const BLOCK_EXIT_CODE = 2;

/** Marks the line we add to the shell rc, so we can find it again and never add it twice. */
const RC_MARKER = '# agentinel';

/** The parts of the environment the shim writes into. Injectable so tests never touch a real rc. */
export interface ShimTarget {
  home: string;
  shell: string;
}

export function currentTarget(): ShimTarget {
  return { home: homedir(), shell: process.env.SHELL ?? '' };
}

export function shimDirectory(home: string): string {
  return join(home, '.agentinel', 'bin');
}

/**
 * Where the PATH line goes. Only interactive shells read an rc file, which is the point: the shim
 * is for commands a person types.
 */
export function shellRcPath(target: ShimTarget): string {
  if (target.shell.includes('zsh')) {
    return join(target.home, '.zshrc');
  }
  if (target.shell.includes('bash')) {
    return join(target.home, '.bashrc');
  }
  return join(target.home, '.profile');
}

export function installShim(repoRoot: string, target: ShimTarget = currentTarget()): number {
  const dir = shimDirectory(target.home);
  mkdirSync(dir, { recursive: true });

  for (const client of CLIENTS) {
    const path = join(dir, client);
    writeFileSync(path, shimScript(client), 'utf8');
    chmodSync(path, 0o755);
  }

  console.log(`wrote shims for ${CLIENTS.join(', ')} in ${dir}`);
  addPathLine(target);

  const mode = loadConfig(repoRoot).mode;
  console.log(
    mode === 'strict'
      ? 'Mode is strict, so a risky package typed at the terminal will be blocked.'
      : 'Mode is warn, so a risky package typed at the terminal will be reported, not blocked.',
  );
  console.log('Open a new terminal, or run `asen unshim` to undo this.');

  return 0;
}

export function removeShim(target: ShimTarget = currentTarget()): number {
  const dir = shimDirectory(target.home);
  rmSync(dir, { recursive: true, force: true });
  console.log(`removed ${dir}`);

  removePathLine(target);
  return 0;
}

function addPathLine(target: ShimTarget): void {
  const path = shellRcPath(target);
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';

  if (existing.includes(RC_MARKER)) {
    console.log(`${path} already puts the shims on PATH, left alone`);
    return;
  }

  const separator = existing === '' || existing.endsWith('\n') ? '' : '\n';
  const line = `export PATH="$HOME/.agentinel/bin:$PATH" ${RC_MARKER}\n`;
  writeFileSync(path, `${existing}${separator}${line}`, 'utf8');
  console.log(`added the shims to PATH in ${path}`);
}

function removePathLine(target: ShimTarget): void {
  const path = shellRcPath(target);
  if (!existsSync(path)) {
    return;
  }

  const lines = readFileSync(path, 'utf8').split('\n');
  const kept = lines.filter((line) => !line.includes(RC_MARKER));
  if (kept.length === lines.length) {
    return;
  }

  writeFileSync(path, kept.join('\n'), 'utf8');
  console.log(`removed the PATH line from ${path}`);
}

/**
 * The shim itself. Written as POSIX sh, not bash, because it has to work as `sh -c "npm i x"` too.
 *
 * Everything about it is arranged so that the real client runs no matter what goes wrong here. The
 * one path that stops the command is agentinel explicitly answering with BLOCK_EXIT_CODE.
 */
function shimScript(client: string): string {
  return `#!/bin/sh
# agentinel shim for ${client}. Checks what the command would pull from the npm registry, then runs
# the real ${client}. Undo with: asen unshim
#
# This script fails open on purpose. If agentinel is missing or broken, ${client} still runs.

client="${client}"

# Our own directory, taken from the script's path rather than from $HOME, which may not be set.
shim_dir=$(CDPATH= cd -- "$(dirname -- "$0")" 2>/dev/null && pwd)

# PATH with our directory removed. The real client is whatever that resolves to. Skipping this is
# how a shim finds itself and recurses until the shell runs out of processes.
real_path=""
saved_ifs=$IFS
IFS=:
for entry in $PATH; do
  if [ -z "$entry" ] || [ "$entry" = "$shim_dir" ]; then
    continue
  fi
  if [ -z "$real_path" ]; then
    real_path="$entry"
  else
    real_path="$real_path:$entry"
  fi
done
IFS=$saved_ifs

real=$(PATH="$real_path" command -v "$client" 2>/dev/null)
if [ -z "$real" ]; then
  echo "agentinel: $client is not installed" >&2
  exit 127
fi

if [ -n "$AGENTINEL_SKIP" ]; then
  exec "$real" "$@"
fi

# Prefer the copy installed in the project, since it starts faster than a global resolve.
if [ -x "./node_modules/.bin/asen" ]; then
  asen="./node_modules/.bin/asen"
else
  asen=$(PATH="$real_path" command -v asen 2>/dev/null)
fi

if [ -n "$asen" ]; then
  # stdin is closed for the check so it can never swallow input meant for the real client.
  "$asen" check-command "$client $*" < /dev/null
  status=$?
  # ${BLOCK_EXIT_CODE} means agentinel decided to stop this. Any other non-zero means agentinel
  # itself failed, and that must not stop the user's command.
  if [ "$status" -eq ${BLOCK_EXIT_CODE} ]; then
    exit 1
  fi
fi

exec "$real" "$@"
`;
}

/**
 * What the shim calls. Takes the whole command line as one string, checks whatever it would pull
 * from the registry, and answers with an exit code.
 *
 * Output goes to stderr so it cannot land in anything that reads the client's stdout.
 */
export async function runCheckCommand(command: string | undefined): Promise<number> {
  if (!command) {
    return 0;
  }

  const { installs, executes } = parseCommand(command);
  const names = [...new Set([...installs, ...executes])];
  if (names.length === 0) {
    return 0;
  }

  const repoRoot = repoRootOrCwd();
  const config = loadConfig(repoRoot);
  const verdicts = await checkPackages(names, config);

  for (const verdict of verdicts) {
    const message = formatVerdict(verdict, process.stderr);
    if (message) {
      console.error('');
      console.error(message);
    }
  }

  const risky = verdicts.filter(isRisky);
  if (config.mode === 'strict' && risky.length > 0) {
    console.error('');
    console.error(denyReason(risky));
    return BLOCK_EXIT_CODE;
  }

  return 0;
}
