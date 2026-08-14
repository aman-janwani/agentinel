import type { DownloadsResult } from '../../types.js';
import { get, isTimeout } from './http.js';

/**
 * PyPI download stats via the pypistats.org API (last month).
 * https://pypistats.org/api/packages/<name>/recent
 *
 * pypistats.org is the standard community download stats source for PyPI packages.
 * We use "last_month" to match the npm downloads window.
 */
export async function fetchPypiDownloads(name: string): Promise<DownloadsResult> {
  const url = `https://pypistats.org/api/packages/${encodeURIComponent(name.toLowerCase())}/recent`;

  let response: Response;
  try {
    response = await get(url, { 'User-Agent': 'agentinel-security-scanner/1.2' });
  } catch (error) {
    return { kind: 'unavailable', reason: describeFailure(error) };
  }

  if (response.status === 404) {
    return { kind: 'no-data' };
  }

  if (!response.ok) {
    return { kind: 'unavailable', reason: `pypistats returned ${response.status}` };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    return { kind: 'unavailable', reason: describeFailure(error) };
  }

  const lastMonth = readPypiDownloads(body);
  if (lastMonth === null) {
    return { kind: 'unavailable', reason: 'pypistats response had no usable count' };
  }

  return { kind: 'found', lastMonth };
}

function readPypiDownloads(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) return null;
  const doc = body as Record<string, unknown>;
  const data = doc.data as Record<string, unknown> | null;
  if (!data) return null;
  const last_month = data.last_month;
  if (typeof last_month !== 'number' || !Number.isFinite(last_month)) return null;
  return last_month;
}

function describeFailure(error: unknown): string {
  return isTimeout(error) ? 'pypistats request timed out' : 'could not reach pypistats.org';
}

/**
 * crates.io download stats — recent downloads from the crates.io API.
 * We use downloads from the last 90 days (recent_downloads field) as a proxy for "last month"
 * since crates.io does not expose a 30-day window directly.
 */
export async function fetchCargoDownloads(name: string): Promise<DownloadsResult> {
  const url = `https://crates.io/api/v1/crates/${encodeURIComponent(name)}`;

  let response: Response;
  try {
    response = await get(url, { 'User-Agent': 'agentinel-security-scanner/1.2' });
  } catch (error) {
    return { kind: 'unavailable', reason: describeFailure2(error) };
  }

  if (response.status === 404) {
    return { kind: 'no-data' };
  }

  if (!response.ok) {
    return { kind: 'unavailable', reason: `crates.io returned ${response.status}` };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    return { kind: 'unavailable', reason: describeFailure2(error) };
  }

  const lastMonth = readCargoDownloads(body);
  if (lastMonth === null) {
    return { kind: 'unavailable', reason: 'crates.io response had no usable download count' };
  }

  return { kind: 'found', lastMonth };
}

function readCargoDownloads(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) return null;
  const doc = body as Record<string, unknown>;
  const krate = doc.crate as Record<string, unknown> | null;
  if (!krate) return null;
  // recent_downloads = last 90 days. Divide by 3 to approximate monthly.
  const recent = krate.recent_downloads;
  if (typeof recent !== 'number' || !Number.isFinite(recent)) return null;
  return Math.floor(recent / 3);
}

function describeFailure2(error: unknown): string {
  return isTimeout(error) ? 'crates.io request timed out' : 'could not reach crates.io';
}
