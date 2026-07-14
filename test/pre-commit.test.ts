import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scanStagedPackages } from '../src/hooks/pre-commit.js';
import { setKnownMalwareForTests } from '../src/checks/package-guard/malware.js';

let repo: string;

function git(...args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
}

function write(name: string, value: unknown): void {
  writeFileSync(join(repo, name), JSON.stringify(value), 'utf8');
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'precommit-'));
  git('init');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  write('package.json', { name: 'root', version: '1.0.0' });
  git('add', '-A');
  git('commit', '-m', 'init');

  // Do not let real npm or the real malware list into these tests.
  setKnownMalwareForTests({});
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith('https://api.npmjs.org/downloads/')) {
        return new Response(JSON.stringify({ downloads: 50_000_000 }));
      }
      const created = new Date('2015-01-01').toISOString();
      return new Response(JSON.stringify({ time: { created } }));
    }),
  );
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
  setKnownMalwareForTests(null);
  vi.unstubAllGlobals();
});

describe('the pre-commit hook', () => {
  it('says nothing when no dependency changed', async () => {
    writeFileSync(join(repo, 'index.js'), 'console.log(1)', 'utf8');
    git('add', '-A');

    expect(await scanStagedPackages(repo)).toEqual([]);
  });

  it('catches malware buried in the staged lockfile, not just package.json', async () => {
    // The gap this closed: a poisoned transitive dependency lives in package-lock.json, not in the
    // package.json diff. Reading the staged lockfile is the only way to see it.
    write('package.json', { name: 'root', dependencies: { express: '^5.0.0' } });
    write('package-lock.json', {
      name: 'root',
      lockfileVersion: 3,
      packages: {
        '': { name: 'root' },
        'node_modules/express': { version: '5.1.0' },
        'node_modules/hidden-malware': { version: '1.0.0' },
      },
    });
    setKnownMalwareForTests({ 'hidden-malware': ['1.0.0'] });
    git('add', '-A');

    const verdicts = await scanStagedPackages(repo);
    const flagged = verdicts.filter((v) => v.kind === 'flagged').map((v) => v.name);

    expect(flagged).toContain('hidden-malware');
  });

  it('does not flag a lockfile whose packages are all fine', async () => {
    write('package.json', { name: 'root', dependencies: { express: '^5.0.0' } });
    write('package-lock.json', {
      name: 'root',
      lockfileVersion: 3,
      packages: {
        '': { name: 'root' },
        'node_modules/express': { version: '5.1.0' },
      },
    });
    git('add', '-A');

    const verdicts = await scanStagedPackages(repo);

    expect(verdicts.filter((v) => v.kind === 'flagged')).toEqual([]);
  });

  it('checks a newly named dependency even when there is no lockfile', async () => {
    write('package.json', { name: 'root', dependencies: { 'brand-new': '^1.0.0' } });
    setKnownMalwareForTests({ 'brand-new': [] });
    git('add', '-A');

    const verdicts = await scanStagedPackages(repo);

    expect(verdicts.some((v) => v.kind === 'flagged' && v.name === 'brand-new')).toBe(true);
  });
});
