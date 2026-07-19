import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCheck } from '../src/commands/check.js';
import { setKnownMalwareForTests } from '../src/checks/package-guard/malware.js';

let repo: string;
let cwd: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'check-'));
  cwd = process.cwd();
  process.chdir(repo);
  execFileSync('git', ['init'], { stdio: 'ignore' });

  setKnownMalwareForTests({});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith('https://api.npmjs.org/downloads/')) {
        return new Response(JSON.stringify({ downloads: 50_000_000 }));
      }
      return new Response(
        JSON.stringify({ time: { created: new Date('2015-01-01').toISOString() } }),
      );
    }),
  );
});

afterEach(() => {
  process.chdir(cwd);
  rmSync(repo, { recursive: true, force: true });
  setKnownMalwareForTests(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('asen check', () => {
  it('exits 0 when a named package is clean', async () => {
    expect(await runCheck(['lodash'])).toBe(0);
  });

  it('exits non-zero when a named package is malware, so it can gate CI', async () => {
    setKnownMalwareForTests({ 'evil-pkg': [] });

    expect(await runCheck(['evil-pkg'])).toBe(1);
  });

  it('reports a nonexistent package', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 })),
    );

    expect(await runCheck(['made-up-name-xyz'])).toBe(1);
  });

  it('says there is nothing to check in an empty repo', async () => {
    expect(await runCheck([])).toBe(0);
  });

  it('scans the working tree lockfile when no package is named, even if unstaged', async () => {
    writeFileSync(
      join(repo, 'package-lock.json'),
      JSON.stringify({
        lockfileVersion: 3,
        packages: { '': { name: 'root' }, 'node_modules/hidden-malware': { version: '1.0.0' } },
      }),
      'utf8',
    );
    setKnownMalwareForTests({ 'hidden-malware': ['1.0.0'] });
    // We do NOT run `git add` here, simulating a fresh uncommitted `npm install`.
    // We only need the file to be tracked or exist. Since package-lock.json might not be tracked,
    // we commit it first clean, then modify it unstaged.
    execFileSync('git', ['add', 'package-lock.json'], { stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'clean lockfile'], { stdio: 'ignore' });

    // Now modify it (unstaged)
    writeFileSync(
      join(repo, 'package-lock.json'),
      JSON.stringify({
        lockfileVersion: 3,
        packages: { '': { name: 'root' }, 'node_modules/unstaged-malware': { version: '1.0.0' } },
      }),
      'utf8',
    );
    setKnownMalwareForTests({ 'unstaged-malware': ['1.0.0'] });

    expect(await runCheck([])).toBe(1);
  });

  it('scans unstaged dependencies in the working tree package.json', async () => {
    // Commit a clean package.json
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ dependencies: {} }), 'utf8');
    execFileSync('git', ['add', 'package.json'], { stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'clean pkg'], { stdio: 'ignore' });

    // Modify unstaged
    writeFileSync(
      join(repo, 'package.json'),
      JSON.stringify({ dependencies: { 'unstaged-evil': '1.0.0' } }),
      'utf8',
    );
    setKnownMalwareForTests({ 'unstaged-evil': [] });

    expect(await runCheck([])).toBe(1);
  });
});
