import { isAllowlisted } from '../../config/schema.js';
import type { Config, DownloadsResult, RegistryResult, Verdict } from '../../types.js';
import { MAX_AGE_DAYS, MIN_MONTHLY_DOWNLOADS } from '../../types.js';
import { fetchDownloads } from './downloads.js';
import { isValidPackageName } from './parse-install.js';
import { fetchRegistry } from './registry.js';

const MS_PER_DAY = 86400000;

/**
 * Decides what to say about a single package. Pure, so the rules can be tested without a network.
 *
 * A package is only flagged when it is both young and unpopular. Either signal on its own is
 * normal: plenty of brand new packages are legitimate, and plenty of old packages are niche.
 */
export function evaluate(
  name: string,
  registry: RegistryResult,
  downloads: DownloadsResult,
  config: Config,
  now: Date = new Date(),
): Verdict {
  const allowed = isAllowlisted(config, name);
  if (allowed.allowed) {
    return { kind: 'allowlisted', name, reason: allowed.reason };
  }

  if (registry.kind === 'not-found') {
    return { kind: 'not-found', name };
  }

  if (registry.kind === 'unavailable') {
    return { kind: 'skipped', name, reason: registry.reason };
  }

  if (downloads.kind === 'unavailable') {
    return { kind: 'skipped', name, reason: downloads.reason };
  }

  // The registry says this package exists, so no download record means no downloads.
  const lastMonth = downloads.kind === 'no-data' ? 0 : downloads.lastMonth;

  const ageDays = Math.floor((now.getTime() - registry.created.getTime()) / MS_PER_DAY);
  if (ageDays < MAX_AGE_DAYS && lastMonth < MIN_MONTHLY_DOWNLOADS) {
    return { kind: 'flagged', name, ageDays, downloads: lastMonth };
  }

  return { kind: 'clean', name };
}

/**
 * A package is only ever flagged when it is unpopular as well as new, so a healthy download count
 * settles it on its own and the registry never needs to be asked. That matters: the registry
 * returns the package's entire version history, which for something like react is several
 * megabytes, while the downloads endpoint answers with a single number.
 */
export function needsRegistryLookup(downloads: DownloadsResult): boolean {
  if (downloads.kind === 'found') {
    return downloads.lastMonth < MIN_MONTHLY_DOWNLOADS;
  }
  return true;
}

/**
 * Checks every package at once. Order of the returned verdicts matches the order the names were
 * first seen, and repeated names are only checked once.
 */
export async function checkPackages(names: string[], config: Config): Promise<Verdict[]> {
  const unique = [...new Set(names)];
  const now = new Date();

  return Promise.all(unique.map((name) => checkOne(name, config, now)));
}

async function checkOne(name: string, config: Config, now: Date): Promise<Verdict> {
  const allowed = isAllowlisted(config, name);
  if (allowed.allowed) {
    return { kind: 'allowlisted', name, reason: allowed.reason };
  }

  // Never put an unvalidated name into a request URL. Dependency names come out of a package.json
  // that we did not write, and a name npm would refuse to install is not worth a network call.
  if (!isValidPackageName(name)) {
    return { kind: 'skipped', name, reason: 'not a valid npm package name' };
  }

  const downloads = await fetchDownloads(name);
  if (!needsRegistryLookup(downloads)) {
    return { kind: 'clean', name };
  }

  const registry = await fetchRegistry(name);
  return evaluate(name, registry, downloads, config, now);
}
