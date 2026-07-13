import { describe, expect, it, vi } from 'vitest';
import { fetchDownloads } from '../src/checks/package-guard/downloads.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('fetchDownloads', () => {
  it('returns the last month download count', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ downloads: 52_000_000, package: 'lodash' })),
    );

    expect(await fetchDownloads('lodash')).toEqual({ kind: 'found', lastMonth: 52_000_000 });
  });

  it('encodes the slash in a scoped package name', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ downloads: 10 }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchDownloads('@scope/pkg');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.npmjs.org/downloads/point/last-month/@scope%2Fpkg',
      expect.anything(),
    );
  });

  it('reports a 404 as no-data, since the API 404s for a package nobody has installed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));

    const result = await fetchDownloads('brand-new-package');

    expect(result.kind).toBe('no-data');
  });

  it('reports an error status as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));

    expect((await fetchDownloads('lodash')).kind).toBe('unavailable');
  });

  it('reports a network failure as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    expect((await fetchDownloads('lodash')).kind).toBe('unavailable');
  });

  it('reports a timeout as unavailable', async () => {
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeout));

    expect(await fetchDownloads('lodash')).toEqual({
      kind: 'unavailable',
      reason: 'downloads request timed out',
    });
  });

  it('reports a malformed body as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'no stats' })));

    expect((await fetchDownloads('lodash')).kind).toBe('unavailable');
  });
});
