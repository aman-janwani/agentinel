import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInit } from '../src/commands/init.js';
import {
  installShim,
  removeShim,
  shellRcPath,
  shimDirectory,
  type ShimTarget,
} from '../src/commands/shim.js';

let home: string;
let repo: string;
let realBin: string;
let cwd: string;
let target: ShimTarget;

/** A stand in for the real npm, so a test can prove it did or did not get run. */
function writeFakeBinary(name: string, body: string): string {
  const path = join(realBin, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`, 'utf8');
  chmodSync(path, 0o755);
  return path;
}

/**
 * Runs an installed shim the way a shell would, with our shim directory first on PATH. If the shim
 * ever resolved itself instead of the real binary this would spin forever, so the test also stands
 * as the guard against recursion.
 */
function runShim(client: string, args: string[]): { stdout: string; status: number } {
  try {
    const stdout = execFileSync(join(shimDirectory(home), client), args, {
      cwd: repo,
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        ...process.env,
        HOME: home,
        PATH: `${shimDirectory(home)}:${realBin}:/usr/bin:/bin`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout, status: 0 };
  } catch (error) {
    const failure = error as { stdout?: string; status?: number };
    return { stdout: failure.stdout ?? '', status: failure.status ?? -1 };
  }
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'asen-home-'));
  repo = mkdtempSync(join(tmpdir(), 'asen-repo-'));
  realBin = mkdtempSync(join(tmpdir(), 'asen-bin-'));
  target = { home, shell: '/bin/zsh' };

  cwd = process.cwd();
  process.chdir(repo);

  writeFakeBinary('npm', 'echo "real npm ran: $*"');
  vi.spyOn(console, 'log').mockImplementation(() => {});

  return () => {
    process.chdir(cwd);
    for (const dir of [home, repo, realBin]) {
      rmSync(dir, { recursive: true, force: true });
    }
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('installShim', () => {
  it('writes an executable shim for every client that installs from npm', () => {
    installShim(repo, target);

    for (const client of ['npm', 'npx', 'pnpm', 'yarn', 'bun']) {
      const path = join(shimDirectory(home), client);
      expect(existsSync(path)).toBe(true);
      // Owner execute bit. A shim that is not executable is not on PATH in any useful sense.
      expect(statSync(path).mode & 0o100).toBe(0o100);
    }
  });

  it('picks the rc file for the shell the user actually runs', () => {
    expect(shellRcPath({ home, shell: '/bin/zsh' })).toBe(join(home, '.zshrc'));
    expect(shellRcPath({ home, shell: '/usr/local/bin/bash' })).toBe(join(home, '.bashrc'));
    expect(shellRcPath({ home, shell: '' })).toBe(join(home, '.profile'));
  });

  it('adds the PATH line once, however many times init runs', () => {
    installShim(repo, target);
    installShim(repo, target);
    installShim(repo, target);

    const rc = readFileSync(join(home, '.zshrc'), 'utf8');
    const added = rc.split('\n').filter((line) => line.includes('.agentinel/bin'));
    expect(added).toHaveLength(1);
    expect(added[0]).toContain('# agentinel');
  });

  it('keeps what was already in the rc file', () => {
    writeFileSync(join(home, '.zshrc'), 'alias gs="git status"', 'utf8');

    installShim(repo, target);

    const rc = readFileSync(join(home, '.zshrc'), 'utf8');
    expect(rc).toContain('alias gs="git status"');
    expect(rc).toContain('export PATH="$HOME/.agentinel/bin:$PATH" # agentinel');
  });

  it('is reachable from init with --shim', () => {
    runInit({ shim: true, shimTarget: target });

    expect(existsSync(join(shimDirectory(home), 'npm'))).toBe(true);
    expect(readFileSync(join(home, '.zshrc'), 'utf8')).toContain('.agentinel/bin');
  });

  it('leaves the shell alone when init runs without the flag', () => {
    runInit({ shimTarget: target });

    expect(existsSync(shimDirectory(home))).toBe(false);
    expect(existsSync(join(home, '.zshrc'))).toBe(false);
  });
});

describe('removeShim', () => {
  it('takes the shims and the PATH line back out', () => {
    writeFileSync(join(home, '.zshrc'), 'alias gs="git status"\n', 'utf8');
    installShim(repo, target);

    removeShim(target);

    expect(existsSync(shimDirectory(home))).toBe(false);
    const rc = readFileSync(join(home, '.zshrc'), 'utf8');
    expect(rc).not.toContain('.agentinel/bin');
    expect(rc).toContain('alias gs="git status"');
  });

  it('does nothing when there is nothing to remove', () => {
    expect(removeShim(target)).toBe(0);
  });
});

// The rules the shim lives or dies by. Breaking someone's npm is worse than missing a check, so
// every one of these is about the real binary still running when agentinel cannot do its job.
describe('the installed shim', () => {
  beforeEach(() => {
    installShim(repo, target);
  });

  it('runs the real binary when agentinel is nowhere to be found', () => {
    const result = runShim('npm', ['install', 'left-pad']);

    expect(result.stdout).toContain('real npm ran: install left-pad');
    expect(result.status).toBe(0);
  });

  it('runs the real binary when agentinel is broken', () => {
    writeFakeBinary('asen', 'echo "boom" >&2\nexit 1');

    const result = runShim('npm', ['install', 'left-pad']);

    expect(result.stdout).toContain('real npm ran: install left-pad');
    expect(result.status).toBe(0);
  });

  it('runs the real binary when agentinel is too old to know the subcommand', () => {
    // An older asen prints its usage and exits 1 for a subcommand it has never heard of. That must
    // read as "agentinel failed", not as "stop", or upgrading the shim alone would break npm.
    writeFakeBinary('asen', 'echo "unknown command: $1" >&2\nexit 1');

    const result = runShim('npm', ['install', 'left-pad']);

    expect(result.stdout).toContain('real npm ran: install left-pad');
    expect(result.status).toBe(0);
  });

  it('runs the real binary when agentinel says the command is fine', () => {
    writeFakeBinary('asen', 'exit 0');

    const result = runShim('npm', ['install', 'left-pad']);

    expect(result.stdout).toContain('real npm ran: install left-pad');
  });

  it('stops the command only when agentinel answers with the block code', () => {
    writeFakeBinary('asen', 'exit 2');

    const result = runShim('npm', ['install', 'evil-pkg']);

    expect(result.stdout).not.toContain('real npm ran');
    expect(result.status).toBe(1);
  });

  it('hands agentinel the whole command line', () => {
    const seen = join(repo, 'seen.txt');
    writeFakeBinary('asen', `echo "$1 $2" > ${seen}\nexit 0`);

    runShim('npm', ['install', 'left-pad']);

    expect(readFileSync(seen, 'utf8').trim()).toBe('check-command npm install left-pad');
  });

  it('can be switched off for one command', () => {
    writeFakeBinary('asen', 'exit 2');

    const stdout = execFileSync(join(shimDirectory(home), 'npm'), ['install', 'evil-pkg'], {
      cwd: repo,
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        ...process.env,
        HOME: home,
        AGENTINEL_SKIP: '1',
        PATH: `${shimDirectory(home)}:${realBin}:/usr/bin:/bin`,
      },
    });

    expect(stdout).toContain('real npm ran');
  });

  it('reports honestly when the real binary genuinely is not installed', () => {
    // pnpm has a shim but no fake binary behind it, so there is nothing to exec.
    const result = runShim('pnpm', ['add', 'left-pad']);

    expect(result.status).toBe(127);
  });
});
