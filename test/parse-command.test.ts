import { describe, expect, it } from 'vitest';
import { parseCommand } from '../src/checks/package-guard/parse-install.js';

const installs = (c: string) => parseCommand(c).installs;
const executes = (c: string) => parseCommand(c).executes;
const lockfile = (c: string) => parseCommand(c).lockfile;

describe('execute commands (npx and friends)', () => {
  it('catches npx, which downloads AND RUNS code immediately', () => {
    // This is the sharpest hole we had. Nothing lands in package.json, so the pre-commit hook
    // never sees it. There is no second line of defence.
    expect(executes('npx evil-pkg')).toEqual(['evil-pkg']);
    expect(executes('npx --yes evil-pkg')).toEqual(['evil-pkg']);
    expect(executes('npx -y evil-pkg --some-arg')).toEqual(['evil-pkg']);
    expect(executes('npx evil-pkg@1.2.3')).toEqual(['evil-pkg']);
    expect(executes('npx @scope/evil-pkg')).toEqual(['@scope/evil-pkg']);
  });

  it('catches the other runners', () => {
    expect(executes('bunx evil-pkg')).toEqual(['evil-pkg']);
    expect(executes('pnpx evil-pkg')).toEqual(['evil-pkg']);
    expect(executes('pnpm dlx evil-pkg')).toEqual(['evil-pkg']);
    expect(executes('yarn dlx evil-pkg')).toEqual(['evil-pkg']);
    expect(executes('npm exec evil-pkg')).toEqual(['evil-pkg']);
  });

  it('only takes the package, not the arguments passed to it', () => {
    expect(executes('npx create-next-app my-app --typescript')).toEqual(['create-next-app']);
    expect(executes('npx tsc --noEmit')).toEqual(['tsc']);
  });

  it('does not guess when the target is not a registry package', () => {
    expect(executes('npx ./local-script.js')).toEqual([]);
    expect(executes('npx')).toEqual([]);
  });

  it('an executed package is not an installed one', () => {
    expect(installs('npx evil-pkg')).toEqual([]);
  });
});

describe('bun', () => {
  it('reads bun installs, which we used to ignore entirely', () => {
    expect(installs('bun add evil-pkg')).toEqual(['evil-pkg']);
    expect(installs('bun install evil-pkg')).toEqual(['evil-pkg']);
    expect(installs('bun i evil-pkg')).toEqual(['evil-pkg']);
    expect(installs('bun add -d evil-pkg')).toEqual(['evil-pkg']);
  });
});

describe('lockfile installs', () => {
  it('recognises an install that names nothing, so we can audit the lockfile', () => {
    // Clone a repo whose lockfile is already poisoned, run npm ci: no package is named, the commit
    // already happened, and we used to see nothing at all.
    expect(lockfile('npm ci')).toBe(true);
    expect(lockfile('npm install')).toBe(true);
    expect(lockfile('npm i')).toBe(true);
    expect(lockfile('yarn')).toBe(true);
    expect(lockfile('yarn install')).toBe(true);
    expect(lockfile('pnpm install')).toBe(true);
    expect(lockfile('bun install')).toBe(true);
    expect(lockfile('npm install --production')).toBe(true);
  });

  it('is not a lockfile install when a package is named', () => {
    expect(lockfile('npm install express')).toBe(false);
    expect(lockfile('bun add express')).toBe(false);
  });

  it('is not a lockfile install for unrelated commands', () => {
    expect(lockfile('npm run build')).toBe(false);
    expect(lockfile('npm publish')).toBe(false);
    expect(lockfile('npx evil-pkg')).toBe(false);
  });
});

describe('still ignores what it should', () => {
  it('leaves non-install commands alone', () => {
    expect(parseCommand('npm run build')).toEqual({ installs: [], executes: [], lockfile: false });
    expect(parseCommand('git status')).toEqual({ installs: [], executes: [], lockfile: false });
    expect(parseCommand('npm uninstall x')).toEqual({
      installs: [],
      executes: [],
      lockfile: false,
    });
  });
});
