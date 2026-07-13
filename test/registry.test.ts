import { describe, expect, it, vi } from 'vitest';
import { fetchRegistry } from '../src/checks/package-guard/registry.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('fetchRegistry', () => {
  it('returns the creation date for a package that exists', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ time: { created: '2015-03-01T10:00:00.000Z' } })),
    );

    const result = await fetchRegistry('lodash');

    expect(result).toEqual({ kind: 'found', created: new Date('2015-03-01T10:00:00.000Z') });
  });

  it('encodes the slash in a scoped package name', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ time: { created: '2020-01-01T00:00:00.000Z' } }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchRegistry('@scope/pkg');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://registry.npmjs.org/@scope%2Fpkg',
      expect.anything(),
    );
  });

  it('reports a 404 as not-found', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));

    expect(await fetchRegistry('definitely-not-a-real-package')).toEqual({ kind: 'not-found' });
  });

  it('reports a non-404 error status as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })));

    const result = await fetchRegistry('lodash');

    expect(result.kind).toBe('unavailable');
  });

  it('reports a network failure as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    const result = await fetchRegistry('lodash');

    expect(result.kind).toBe('unavailable');
  });

  it('reports a timeout as unavailable', async () => {
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeout));

    const result = await fetchRegistry('lodash');

    expect(result).toEqual({ kind: 'unavailable', reason: 'registry request timed out' });
  });

  it('calls a timeout during the body download a timeout, not malformed JSON', async () => {
    // Some of these documents are large (15MB for @typescript-eslint/parser), so the abort often
    // fires while the body is still streaming. Reporting that as bad JSON sent us hunting for a
    // registry bug that did not exist.
    const aborted = new Error('The operation was aborted');
    aborted.name = 'AbortError';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: () => Promise.reject(aborted),
      }),
    );

    const result = await fetchRegistry('@typescript-eslint/parser');

    expect(result).toEqual({ kind: 'unavailable', reason: 'registry request timed out' });
  });

  it('reports a missing creation date as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ time: {} })));

    const result = await fetchRegistry('lodash');

    expect(result.kind).toBe('unavailable');
  });

  it('reports an unparseable creation date as unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ time: { created: 'not a date' } })),
    );

    const result = await fetchRegistry('lodash');

    expect(result.kind).toBe('unavailable');
  });
});
