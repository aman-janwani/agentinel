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
  shimDirectory,
  shimFileName,
  startupFilePath,
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
  // The runtime tests below execute the real shim, so they use this machine's own platform. The
  // Windows-artifact tests further down force platform: 'win32' explicitly instead.
  target = { home, shell: '/bin/zsh', platform: process.platform };

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

  it('picks the startup file for the shell the user actually runs', () => {
    const on = (shell: string, platform: NodeJS.Platform = 'linux'): string =>
      startupFilePath({ home, shell, platform });

    expect(on('/bin/zsh')).toBe(join(home, '.zshrc'));
    expect(on('/usr/local/bin/bash')).toBe(join(home, '.bashrc'));
    expect(on('')).toBe(join(home, '.profile'));
    // Windows uses the PowerShell profile, whatever SHELL says.
    expect(on('', 'win32')).toBe(
      join(home, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1'),
    );
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

// Windows cannot run the sh shim and does not read a .zshrc, so it gets .cmd scripts and a line in
// the PowerShell profile. This machine is not Windows, so these tests do not execute the shim; they
// assert that the right files, with the right content, are generated for a win32 target. The rules
// the batch shim must honour (skip our own dir, block only on the exact block code, fail open
// otherwise) are checked by reading the generated script.
describe('the Windows shim', () => {
  let winHome: string;
  let winTarget: ShimTarget;

  beforeEach(() => {
    winHome = mkdtempSync(join(tmpdir(), 'asen-win-'));
    winTarget = { home: winHome, shell: '', platform: 'win32' };
    vi.spyOn(console, 'log').mockImplementation(() => {});
    return () => rmSync(winHome, { recursive: true, force: true });
  });

  it('names each shim with a .cmd extension so Windows will run it', () => {
    for (const client of ['npm', 'npx', 'pnpm', 'yarn', 'bun']) {
      expect(shimFileName(client, winTarget)).toBe(`${client}.cmd`);
    }
  });

  it('writes a .cmd batch script for every client', () => {
    installShim(winHome, winTarget);

    for (const client of ['npm', 'npx', 'pnpm', 'yarn', 'bun']) {
      const path = join(shimDirectory(winHome), `${client}.cmd`);
      expect(existsSync(path)).toBe(true);
      const script = readFileSync(path, 'utf8');
      expect(script).toContain('@echo off');
      // Uses CRLF line endings, which batch needs.
      expect(script).toContain('\r\n');
    }
  });

  it('makes the batch shim skip its own directory, so it cannot recurse', () => {
    installShim(winHome, winTarget);
    const script = readFileSync(join(shimDirectory(winHome), 'npm.cmd'), 'utf8');

    expect(script).toContain('.agentinel\\bin');
    expect(script).toContain('where npm');
  });

  it('makes the batch shim block only on the exact block code, and fail open otherwise', () => {
    installShim(winHome, winTarget);
    const script = readFileSync(join(shimDirectory(winHome), 'npm.cmd'), 'utf8');

    // Exact string match on the block code, not ">= 2", so a crash (code 1) runs the real client.
    expect(script).toContain('if "!errorlevel!"=="2" exit /b 1');
    // And it runs the real client at the end no matter what.
    expect(script).toContain('"!real!" %*');
  });

  it('adds the shims to PATH through the PowerShell profile', () => {
    installShim(winHome, winTarget);

    const profile = join(winHome, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1');
    expect(existsSync(profile)).toBe(true);
    const text = readFileSync(profile, 'utf8');
    expect(text).toContain('$env:Path');
    expect(text).toContain('.agentinel\\bin');
    expect(text).toContain('# agentinel');
  });

  it('adds the PowerShell PATH line only once', () => {
    installShim(winHome, winTarget);
    installShim(winHome, winTarget);

    const profile = join(winHome, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1');
    const added = readFileSync(profile, 'utf8')
      .split('\n')
      .filter((line) => line.includes('.agentinel'));
    expect(added).toHaveLength(1);
  });

  it('removes the .cmd shims and the PowerShell line on unshim', () => {
    installShim(winHome, winTarget);
    removeShim(winTarget);

    expect(existsSync(shimDirectory(winHome))).toBe(false);
    const profile = join(winHome, 'Documents', 'PowerShell', 'Microsoft.PowerShell_profile.ps1');
    expect(readFileSync(profile, 'utf8')).not.toContain('.agentinel');
  });
});

describe('the Linux shim', () => {
  it('uses .bashrc and a bare shim name, like macOS', () => {
    const linHome = mkdtempSync(join(tmpdir(), 'asen-lin-'));
    const linTarget: ShimTarget = { home: linHome, shell: '/bin/bash', platform: 'linux' };

    expect(shimFileName('npm', linTarget)).toBe('npm');
    expect(startupFilePath(linTarget)).toBe(join(linHome, '.bashrc'));

    rmSync(linHome, { recursive: true, force: true });
  });
});
