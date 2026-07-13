import { describe, expect, it, vi } from 'vitest';
import { checkPackages, evaluate } from '../src/checks/package-guard/evaluate.js';
import { defaultConfig } from '../src/config/schema.js';
import type { Config, DownloadsResult, RegistryResult } from '../src/types.js';

const NOW = new Date('2026-07-13T00:00:00.000Z');

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 86400000);
}

function found(days: number): RegistryResult {
  return { kind: 'found', created: daysAgo(days) };
}

function downloads(lastMonth: number): DownloadsResult {
  return { kind: 'found', lastMonth };
}

function configAllowing(name: string, reason: string): Config {
  return { mode: 'warn', allow: [{ name, reason, date: '2026-07-01' }] };
}

describe('evaluate', () => {
  it('passes an old, popular package', () => {
    const verdict = evaluate('lodash', found(3000), downloads(50_000_000), defaultConfig(), NOW);

    expect(verdict).toEqual({ kind: 'clean', name: 'lodash' });
  });

  it('flags a brand new package the downloads API has no record of at all', () => {
    const verdict = evaluate('legible-mutex', found(0), { kind: 'no-data' }, defaultConfig(), NOW);

    expect(verdict).toEqual({ kind: 'flagged', name: 'legible-mutex', ageDays: 0, downloads: 0 });
  });

  it('does not flag an old package the downloads API has no record of', () => {
    const verdict = evaluate(
      'ancient-thing',
      found(900),
      { kind: 'no-data' },
      defaultConfig(),
      NOW,
    );

    expect(verdict).toEqual({ kind: 'clean', name: 'ancient-thing' });
  });

  it('flags a new, unpopular package and carries the numbers through', () => {
    const verdict = evaluate('fastapi-utils-js', found(3), downloads(12), defaultConfig(), NOW);

    expect(verdict).toEqual({
      kind: 'flagged',
      name: 'fastapi-utils-js',
      ageDays: 3,
      downloads: 12,
    });
  });

  it('passes a new but popular package', () => {
    const verdict = evaluate('hot-new-thing', found(2), downloads(80_000), defaultConfig(), NOW);

    expect(verdict.kind).toBe('clean');
  });

  it('passes an old but unpopular package', () => {
    const verdict = evaluate('quiet-old-tool', found(900), downloads(4), defaultConfig(), NOW);

    expect(verdict.kind).toBe('clean');
  });

  it('does not flag a package that is exactly at the age threshold', () => {
    const verdict = evaluate('borderline', found(30), downloads(5), defaultConfig(), NOW);

    expect(verdict.kind).toBe('clean');
  });

  it('reports a package the registry has never heard of as not-found', () => {
    const verdict = evaluate('made-up-name', { kind: 'not-found' }, downloads(0), defaultConfig());

    expect(verdict).toEqual({ kind: 'not-found', name: 'made-up-name' });
  });

  it('skips when the registry is unavailable', () => {
    const registry: RegistryResult = { kind: 'unavailable', reason: 'registry request timed out' };

    const verdict = evaluate('lodash', registry, downloads(10), defaultConfig(), NOW);

    expect(verdict).toEqual({
      kind: 'skipped',
      name: 'lodash',
      reason: 'registry request timed out',
    });
  });

  it('skips when the downloads API is unavailable', () => {
    const stats: DownloadsResult = {
      kind: 'unavailable',
      reason: 'could not reach the npm downloads API',
    };

    const verdict = evaluate('lodash', found(2), stats, defaultConfig(), NOW);

    expect(verdict).toEqual({
      kind: 'skipped',
      name: 'lodash',
      reason: 'could not reach the npm downloads API',
    });
  });

  it('allowlists a package that would otherwise be flagged', () => {
    const config = configAllowing('internal-tool', 'published by our own team');

    const verdict = evaluate('internal-tool', found(1), downloads(0), config, NOW);

    expect(verdict).toEqual({
      kind: 'allowlisted',
      name: 'internal-tool',
      reason: 'published by our own team',
    });
  });

  it('allowlists ahead of a not-found registry result', () => {
    const config = configAllowing('internal-tool', 'private registry package');

    const verdict = evaluate('internal-tool', { kind: 'not-found' }, downloads(0), config, NOW);

    expect(verdict.kind).toBe('allowlisted');
  });
});

describe('checkPackages', () => {
  it('returns one verdict per unique name, in input order', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith('https://registry.npmjs.org/')) {
        const created = url.endsWith('lodash') ? daysAgo(3000) : daysAgo(2);
        return new Response(JSON.stringify({ time: { created: created.toISOString() } }));
      }
      const count = url.endsWith('lodash') ? 50_000_000 : 7;
      return new Response(JSON.stringify({ downloads: count }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const verdicts = await checkPackages(['lodash', 'sketchy-pkg', 'lodash'], defaultConfig());

    expect(verdicts.map((verdict) => verdict.kind)).toEqual(['clean', 'flagged']);
    expect(verdicts.map((verdict) => verdict.name)).toEqual(['lodash', 'sketchy-pkg']);
  });
});
