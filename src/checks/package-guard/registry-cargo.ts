import type { RegistryResult } from '../../types.js';
import { get, isTimeout } from './http.js';

/**
 * Fetches crate metadata from the crates.io API.
 * https://crates.io/api/v1/crates/<name>
 *
 * Maps the crates.io response to the shared RegistryResult type so evaluate() needs zero changes.
 * crates.io does not yank entire crates (only individual versions), so securityHold is always false.
 */
export async function fetchCargoRegistry(name: string): Promise<RegistryResult> {
  const url = `https://crates.io/api/v1/crates/${encodeURIComponent(name)}`;

  let response: Response;
  try {
    response = await get(url, { 'User-Agent': 'agentinel-security-scanner/1.2' });
  } catch (error) {
    return { kind: 'unavailable', reason: describeFailure(error) };
  }

  if (response.status === 404) {
    return { kind: 'not-found' };
  }

  if (!response.ok) {
    return { kind: 'unavailable', reason: `crates.io returned ${response.status}` };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    return { kind: 'unavailable', reason: describeFailure(error) };
  }

  const facts = readCargoFacts(body);
  if (facts === null) {
    return { kind: 'unavailable', reason: 'crates.io response had no usable metadata' };
  }

  return { kind: 'found', facts };
}

function readCargoFacts(body: unknown): import('../../types.js').PackageFacts | null {
  if (typeof body !== 'object' || body === null) return null;
  const doc = body as Record<string, unknown>;
  const krate = doc.crate as Record<string, unknown> | null;
  if (!krate) return null;

  const createdStr = krate.created_at;
  if (typeof createdStr !== 'string') return null;
  const created = new Date(createdStr);
  if (Number.isNaN(created.getTime())) return null;

  const versions = doc.versions as Array<Record<string, unknown>> | null;
  const versionCount = Array.isArray(versions) ? versions.length : 0;

  // Latest non-yanked version
  const latest = Array.isArray(versions) ? versions.find((v) => !v.yanked) : null;
  const latestVersion = latest && typeof latest.num === 'string' ? latest.num : null;

  const repository = typeof krate.repository === 'string' ? krate.repository : null;

  return {
    created,
    latestVersion,
    securityHold: false, // crates.io yanks individual versions, not entire crates
    versionCount,
    hasRepository: repository !== null,
    latestPublisher: null,
    priorPublishers: [],
    unpackedSize: null,
    previousUnpackedSize: null,
    latestIsSmallBump: false,
  };
}

function describeFailure(error: unknown): string {
  return isTimeout(error) ? 'crates.io request timed out' : 'could not reach crates.io';
}
