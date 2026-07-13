import type { DownloadsResult } from '../../types.js';

const DOWNLOADS_URL = 'https://api.npmjs.org/downloads/point/last-month';
const TIMEOUT_MS = 3000;

/**
 * Asks the npm downloads API how many times a package was downloaded in the last month.
 *
 * A 404 here means the API has no download record for the name at all. Paired with a package the
 * registry confirms exists, that means nobody has installed it yet, which is exactly the state a
 * freshly registered slopsquat package is in. It gets reported as 'no-data' rather than as an
 * error, so the check still runs instead of being skipped.
 */
export async function fetchDownloads(name: string): Promise<DownloadsResult> {
  const url = `${DOWNLOADS_URL}/${name.replace('/', '%2F')}`;

  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    return { kind: 'unavailable', reason: describeFetchError(error) };
  }

  if (response.status === 404) {
    return { kind: 'no-data' };
  }

  if (!response.ok) {
    return { kind: 'unavailable', reason: `downloads API returned ${response.status}` };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: 'unavailable', reason: 'downloads response was not valid JSON' };
  }

  const lastMonth = readDownloadCount(body);
  if (lastMonth === null) {
    return { kind: 'unavailable', reason: 'downloads response had no usable count' };
  }

  return { kind: 'found', lastMonth };
}

function readDownloadCount(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }

  const downloads = (body as Record<string, unknown>).downloads;
  if (typeof downloads !== 'number' || !Number.isFinite(downloads)) {
    return null;
  }

  return downloads;
}

function describeFetchError(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return 'downloads request timed out';
  }
  return 'could not reach the npm downloads API';
}
