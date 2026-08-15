import type { RegistryResult } from '../../types.js';
import { get, isTimeout } from './http.js';

/**
 * Fetches package metadata from PyPI JSON API.
 * https://pypi.org/pypi/<name>/json
 *
 * Maps the PyPI response to the shared RegistryResult type so evaluate() needs zero changes.
 * PyPI does not have a "security hold" concept equivalent to npm's, so that field is always false.
 */
export async function fetchPypiRegistry(name: string): Promise<RegistryResult> {
  const url = `https://pypi.org/pypi/${encodeURIComponent(name)}/json`;

  let response: Response;
  try {
    response = await get(url);
  } catch (error) {
    return { kind: 'unavailable', reason: describeFailure(error) };
  }

  if (response.status === 404) {
    return { kind: 'not-found' };
  }

  if (!response.ok) {
    return { kind: 'unavailable', reason: `PyPI returned ${response.status}` };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    return { kind: 'unavailable', reason: describeFailure(error) };
  }

  const facts = readPypiFacts(body);
  if (facts === null) {
    return { kind: 'unavailable', reason: 'PyPI response had no usable metadata' };
  }

  return { kind: 'found', facts };
}

function readPypiFacts(body: unknown): import('../../types.js').PackageFacts | null {
  if (typeof body !== 'object' || body === null) return null;
  const doc = body as Record<string, unknown>;
  const info = doc.info as Record<string, unknown> | null;
  if (!info) return null;

  // PyPI uses upload time of the first release as "created"
  const releases = doc.releases as Record<string, unknown[]> | null;
  const versionList = Object.keys(releases ?? {});
  const versionCount = versionList.length;

  // Find the earliest upload time across all releases
  let created: Date | null = null;
  for (const uploads of Object.values(releases ?? {})) {
    for (const upload of uploads as Array<Record<string, unknown>>) {
      const ts = upload.upload_time_iso_8601 ?? upload.upload_time;
      if (typeof ts === 'string') {
        const d = new Date(ts);
        if (!Number.isNaN(d.getTime())) {
          if (created === null || d < created) created = d;
        }
      }
    }
  }

  if (created === null) return null;

  const latestVersion = typeof info.version === 'string' ? info.version : null;
  const homePageOrSource =
    typeof info.home_page === 'string'
      ? info.home_page
      : typeof info.project_urls === 'object' && info.project_urls !== null
        ? (Object.values(info.project_urls as Record<string, string>)[0] ?? null)
        : null;

  return {
    created,
    latestVersion,
    securityHold: false, // PyPI has no equivalent hold mechanism
    versionCount,
    hasRepository: homePageOrSource !== null,
    latestPublisher: typeof info.author === 'string' && info.author ? info.author : null,
    priorPublishers: [],
    unpackedSize: null,
    previousUnpackedSize: null,
    latestIsSmallBump: false,
  };
}

function describeFailure(error: unknown): string {
  return isTimeout(error) ? 'PyPI request timed out' : 'could not reach PyPI';
}
