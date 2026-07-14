import type { PackageFacts, RegistryResult } from '../../types.js';
import { get, isTimeout } from './http.js';

const REGISTRY_URL = 'https://registry.npmjs.org';

/**
 * Reads everything useful the npm registry knows about a package, in one request.
 *
 * The packument is the only thing we fetch, and it carries far more than the creation date: who
 * published each version, how many versions exist, whether there is a repository link, how big the
 * tarball is, and whether npm has taken the package down. All of those signals are free, and unlike
 * age they do not stop working after 30 days.
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

  const facts = readFacts(body);
  if (facts === null) {
    return { kind: 'unavailable', reason: 'registry response had no usable creation date' };
  }

  return { kind: 'found', facts };
}

function readFacts(body: unknown): PackageFacts | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const doc = body as Record<string, unknown>;

  const created = readCreatedDate(doc);
  if (created === null) {
    return null;
  }

  const versions = asRecord(doc.versions) ?? {};
  const order = versionsInPublishOrder(doc, versions);
  const latestName = latestVersionName(doc, order);
  const latest = latestName ? asRecord(versions[latestName]) : null;

  const previousName = order[order.indexOf(latestName ?? '') - 1];
  const previous = previousName ? asRecord(versions[previousName]) : null;

  const latestPublisher = publisherOf(latest);
  const priorPublishers = order
    .filter((v) => v !== latestName)
    .map((v) => publisherOf(asRecord(versions[v])))
    .filter((p): p is string => p !== null);

  return {
    created,
    latestVersion: latestName,
    securityHold: isSecurityHold(doc, latestName),
    versionCount: Object.keys(versions).length,
    hasRepository: Boolean(latest?.repository ?? doc.repository),
    latestPublisher,
    priorPublishers,
    unpackedSize: sizeOf(latest),
    previousUnpackedSize: sizeOf(previous),
    latestIsSmallBump: isSmallBump(previousName, latestName),
  };
}

/**
 * npm replaces a package it has taken down with a stub: the version is suffixed `-security` and the
 * description reads "security holding package". This is npm itself declaring the package malicious.
 * It is definitive, it costs nothing to check, and it never expires.
 */
function isSecurityHold(doc: Record<string, unknown>, latestName: string | null): boolean {
  if (typeof latestName === 'string' && latestName.endsWith('-security')) {
    return true;
  }
  const description = doc.description;
  return typeof description === 'string' && description.toLowerCase().includes('security holding');
}

function publisherOf(version: Record<string, unknown> | null): string | null {
  const user = asRecord(version?._npmUser);
  const name = user?.name;
  return typeof name === 'string' ? name : null;
}

function sizeOf(version: Record<string, unknown> | null): number | null {
  const dist = asRecord(version?.dist);
  const size = dist?.unpackedSize;
  return typeof size === 'number' && Number.isFinite(size) ? size : null;
}

/** Versions ordered by when they were published, which is the order the `time` map records. */
function versionsInPublishOrder(
  doc: Record<string, unknown>,
  versions: Record<string, unknown>,
): string[] {
  const time = asRecord(doc.time) ?? {};
  return Object.keys(time)
    .filter((key) => key !== 'created' && key !== 'modified' && key in versions)
    .sort((a, b) => Date.parse(String(time[a])) - Date.parse(String(time[b])));
}

function latestVersionName(doc: Record<string, unknown>, order: string[]): string | null {
  const tags = asRecord(doc['dist-tags']);
  const latest = tags?.latest;
  if (typeof latest === 'string') {
    return latest;
  }
  return order.length > 0 ? (order[order.length - 1] ?? null) : null;
}

/** A patch or minor bump. A size jump only means something when the version barely changed. */
function isSmallBump(previous: string | undefined, latest: string | null): boolean {
  if (!previous || !latest) {
    return false;
  }
  const major = (v: string) => v.split('.')[0];
  return major(previous) === major(latest);
}

function readCreatedDate(doc: Record<string, unknown>): Date | null {
  const time = asRecord(doc.time);
  const created = time?.created;
  if (typeof created !== 'string') {
    return null;
  }

  const parsed = new Date(created);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function describeFailure(error: unknown): string {
  return isTimeout(error) ? 'registry request timed out' : 'could not reach the npm registry';
}
