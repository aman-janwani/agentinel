import type { RegistryResult } from '../../types.js';

const REGISTRY_URL = 'https://registry.npmjs.org';
const TIMEOUT_MS = 3000;

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
    response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    return { kind: 'unavailable', reason: describeFetchError(error) };
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
  } catch {
    return { kind: 'unavailable', reason: 'registry response was not valid JSON' };
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

function describeFetchError(error: unknown): string {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return 'registry request timed out';
  }
  return 'could not reach the npm registry';
}
