import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkPackages, needsRegistryLookup } from '../src/checks/package-guard/evaluate.js';
import { defaultConfig } from '../src/config/schema.js';
import type { Config } from '../src/types.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Answers the downloads endpoint with a count, and the registry with a creation date.
 *
 * The creation date is pinned here rather than computed inside the mock. checkPackages reads the
 * clock before it fetches, so a date built at fetch time is fractionally younger than intended and
 * the floored age comes out a day short.
 */
function stubNpm(downloads: number, createdDaysAgo: number) {
  const created = new Date(Date.now() - createdDaysAgo * 86400000).toISOString();

  const fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith('https://api.npmjs.org/downloads/')) {
      return new Response(JSON.stringify({ downloads }));
    }
    return new Response(JSON.stringify({ time: { created } }));
  });

  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('needsRegistryLookup', () => {
  it('is false for a package with plenty of downloads, since it can never be flagged', () => {
    expect(needsRegistryLookup({ kind: 'found', lastMonth: 50_000 })).toBe(false);
  });

  it('is true when downloads are low, because age now decides it', () => {
    expect(needsRegistryLookup({ kind: 'found', lastMonth: 4 })).toBe(true);
  });

  it('is true when there is no download data at all', () => {
    expect(needsRegistryLookup({ kind: 'no-data' })).toBe(true);
    expect(needsRegistryLookup({ kind: 'unavailable', reason: 'offline' })).toBe(true);
  });
});

describe('checkPackages', () => {
  it('never fetches the registry for a popular package', async () => {
    // The registry returns the package's whole version history, which for react is several
    // megabytes. A healthy download count already rules out a flag, so it must not be requested.
    const fetchMock = stubNpm(50_000_000, 3000);

    const verdicts = await checkPackages(['react'], defaultConfig(), 'quick');

    expect(verdicts).toEqual([{ kind: 'clean', name: 'react' }]);
    const urls = fetchMock.mock.calls.map((call) => call[0] as string);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('api.npmjs.org/downloads');
  });

  it('does fetch the registry when downloads are low, since age decides it', async () => {
    const fetchMock = stubNpm(4, 2);

    const verdicts = await checkPackages(['sketchy-pkg'], defaultConfig(), 'quick');

    const verdict = verdicts[0]!;
    expect(verdict.kind).toBe('flagged');
    if (verdict.kind === 'flagged') {
      expect(verdict.reasons).toContainEqual({
        kind: 'new-and-unpopular',
        ageDays: 2,
        downloads: 4,
      });
    }
    const urls = fetchMock.mock.calls.map((call) => call[0] as string);
    expect(urls.some((url) => url.startsWith('https://registry.npmjs.org/'))).toBe(true);
  });

  it('never puts an unvalidated name into a request URL', async () => {
    const fetchMock = stubNpm(0, 0);

    const verdicts = await checkPackages(['../../-/user/x'], defaultConfig());

    expect(verdicts[0]).toMatchObject({ kind: 'skipped', reason: 'not a valid npm package name' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not touch the network for an allowlisted package', async () => {
    const fetchMock = stubNpm(0, 0);
    const config: Config = {
      mode: 'warn',
      allow: [{ name: 'internal', reason: 'ours', date: '2026-01-01' }],
    };

    const verdicts = await checkPackages(['internal'], config);

    expect(verdicts[0]).toMatchObject({ kind: 'allowlisted' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not lose every other verdict when one package blows up', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('boom')) {
        throw new Error('something unexpected');
      }
      if (url.startsWith('https://api.npmjs.org/downloads/')) {
        return new Response(JSON.stringify({ downloads: 50_000_000 }));
      }
      return new Response(JSON.stringify({ time: { created: new Date(0).toISOString() } }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const verdicts = await checkPackages(['react', 'boom', 'lodash'], defaultConfig());

    expect(verdicts.map((verdict) => verdict.kind)).toEqual(['clean', 'skipped', 'clean']);
  });

  it('escapes a scoped name so the registry sees one path segment', async () => {
    const fetchMock = stubNpm(2, 1);

    await checkPackages(['@scope/pkg'], defaultConfig());

    const urls = fetchMock.mock.calls.map((call) => call[0] as string);
    expect(urls.every((url) => url.includes('%2F'))).toBe(true);
  });
});
