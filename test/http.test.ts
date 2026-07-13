import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchDownloads } from '../src/checks/package-guard/downloads.js';
import { fetchRegistry } from '../src/checks/package-guard/registry.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function timeoutError(): Error {
  const error = new Error('The operation was aborted due to timeout');
  error.name = 'TimeoutError';
  return error;
}

describe('retrying a timed out request', () => {
  it('retries the downloads endpoint once before giving up', async () => {
    // A popular package like date-fns occasionally blew the old 3 second budget, and a timeout
    // means the package is never checked at all. One retry turns a blip into a successful check.
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(timeoutError())
      .mockResolvedValueOnce(new Response(JSON.stringify({ downloads: 9_000_000 })));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchDownloads('date-fns');

    expect(result).toEqual({ kind: 'found', lastMonth: 9_000_000 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries the registry once before giving up', async () => {
    const created = new Date('2020-01-01').toISOString();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(timeoutError())
      .mockResolvedValueOnce(new Response(JSON.stringify({ time: { created } })));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchRegistry('date-fns');

    expect(result.kind).toBe('found');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry and says it timed out', async () => {
    const fetchMock = vi.fn().mockRejectedValue(timeoutError());
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchDownloads('date-fns');

    expect(result).toEqual({ kind: 'unavailable', reason: 'downloads request timed out' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 404, which is a real answer and not a failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchDownloads('brand-new-package');

    expect(result.kind).toBe('no-data');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
