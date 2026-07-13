import type { RegistryResult } from '../../types.js';
import { get, isTimeout } from './http.js';

const REGISTRY_URL = 'https://registry.npmjs.org';

/**
 * Looks up a package on the public npm registry to find out when it was first published.
 *
 * We never treat a failure here as "the package is fine" or "the package is bad". If the registry
 * is unreachable or gives us something we can't read, we say so and let the caller decide.
 */
export async function fetchRegistry(name: string): Promise<RegistryResult> {
  // A scoped name like @scope/pkg has to keep its slash escaped or the registry sees two path
  // segments and returns a 404.
  const url = `${REGISTRY_URL}/${name.replace('/', '%2F')}`;

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
    return { kind: 'unavailable', reason: `registry returned ${response.status}` };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    // The timeout can fire while the body is still downloading, not just while connecting. Some
    // of these documents are large, 15MB for @typescript-eslint/parser, so this is a normal way
    // to fail on a slow connection and must not be reported as malformed JSON.
    return { kind: 'unavailable', reason: describeFailure(error) };
  }

  const created = readCreatedDate(body);
  if (created === null) {
    return { kind: 'unavailable', reason: 'registry response had no usable creation date' };
  }

  return { kind: 'found', created };
}

function readCreatedDate(body: unknown): Date | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }

  const time = (body as Record<string, unknown>).time;
  if (typeof time !== 'object' || time === null) {
    return null;
  }

  const created = (time as Record<string, unknown>).created;
  if (typeof created !== 'string') {
    return null;
  }

  const parsed = new Date(created);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

function describeFailure(error: unknown): string {
  return isTimeout(error) ? 'registry request timed out' : 'could not reach the npm registry';
}
