import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  packagesInLockfile,
  stagedLockfilePackages,
} from '../src/checks/package-guard/lockfile.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lock-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeLock(value: unknown): void {
  writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(value), 'utf8');
}

describe('packagesInLockfile', () => {
  it('reads name and version from a v3 lockfile, including transitive packages', () => {
    writeLock({
      lockfileVersion: 3,
      packages: {
        '': { name: 'root' },
        'node_modules/express': { version: '5.1.0' },
        'node_modules/express/node_modules/debug': { version: '4.4.3' },
      },
    });

    const packages = packagesInLockfile(dir);

    expect(packages).toContainEqual({ name: 'express', version: '5.1.0' });
    expect(packages).toContainEqual({ name: 'debug', version: '4.4.3' });
  });

  it('reads a v1 lockfile, which nests dependencies', () => {
    writeLock({
      lockfileVersion: 1,
      dependencies: {
        express: { version: '4.18.0', dependencies: { debug: { version: '2.6.9' } } },
      },
    });

    const packages = packagesInLockfile(dir);

    expect(packages).toContainEqual({ name: 'express', version: '4.18.0' });
    expect(packages).toContainEqual({ name: 'debug', version: '2.6.9' });
  });

  it('ignores the project itself and any workspace link', () => {
    writeLock({
      lockfileVersion: 3,
      packages: { '': { name: 'root' }, 'node_modules/dep': { version: '1.0.0' } },
    });

    expect(packagesInLockfile(dir).some((p) => p.name === 'root')).toBe(false);
  });

  it('returns nothing when there is no lockfile', () => {
    expect(packagesInLockfile(dir)).toEqual([]);
  });

  it('returns nothing for a corrupt lockfile rather than throwing', () => {
    writeFileSync(join(dir, 'package-lock.json'), '{ not json', 'utf8');

    expect(packagesInLockfile(dir)).toEqual([]);
  });
});

describe('stagedLockfilePackages', () => {
  it('reads the staged copy of the lockfile, not the working copy', () => {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 't@t.com'], { cwd: dir, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'T'], { cwd: dir, stdio: 'ignore' });

    writeLock({
      lockfileVersion: 3,
      packages: { '': { name: 'root' }, 'node_modules/staged-dep': { version: '2.0.0' } },
    });
    execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });

    // Change the working copy after staging. We must read the STAGED version, not this.
    writeLock({ lockfileVersion: 3, packages: { '': { name: 'root' } } });

    const packages = stagedLockfilePackages(dir);

    expect(packages).toContainEqual({ name: 'staged-dep', version: '2.0.0' });
  });

  it('returns nothing when nothing is staged', () => {
    execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });

    expect(stagedLockfilePackages(dir)).toEqual([]);
  });
});
