import { isAllowlisted } from '../../config/schema.js';
import type { Config, DownloadsResult, Reason, RegistryResult, Verdict } from '../../types.js';
import { MAX_AGE_DAYS, MIN_MONTHLY_DOWNLOADS, SIZE_JUMP_RATIO } from '../../types.js';
import { fetchDownloads } from './downloads.js';
import { isKnownMalware } from './malware.js';
import { isValidPackageName } from './parse-install.js';
import { fetchRegistry } from './registry.js';

const MS_PER_DAY = 86400000;

/**
 * Decides what to say about a single package. Pure, so the rules can be tested without a network.
 *
 * The rules are deliberately layered. Known malware and an npm takedown are *facts*, and they never
 * expire. Age and downloads are a *guess*, and they stop meaning anything after thirty days, which
 * is why they cannot be the only thing we look at. The remaining signals exist to catch what the
 * first two miss: a package nobody has caught yet.
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

  // A package that is malware in every version can be called out with no other information at all.
  // A package where only *some* versions were compromised (chalk, debug, react all appear in the
  // malware data for exactly this reason) needs the version, which only the registry can tell us.
  const version = registry.kind === 'found' ? registry.facts.latestVersion : null;
  const confirmed: Reason[] = isKnownMalware(name, version) ? [{ kind: 'known-malware' }] : [];

  if (registry.kind === 'not-found') {
    return confirmed.length > 0
      ? { kind: 'flagged', name, reasons: confirmed }
      : { kind: 'not-found', name };
  }

  if (registry.kind === 'unavailable') {
    return confirmed.length > 0
      ? { kind: 'flagged', name, reasons: confirmed }
      : { kind: 'skipped', name, reason: registry.reason };
  }

  if (downloads.kind === 'unavailable') {
    return confirmed.length > 0
      ? { kind: 'flagged', name, reasons: confirmed }
      : { kind: 'skipped', name, reason: downloads.reason };
  }

  const facts = registry.facts;
  // The registry says this package exists, so no download record means no downloads.
  const lastMonth = downloads.kind === 'no-data' ? 0 : downloads.lastMonth;
  const ageDays = Math.floor((now.getTime() - facts.created.getTime()) / MS_PER_DAY);

  const reasons: Reason[] = [...confirmed];

  // npm itself has taken this package down. Definitive, and unlike age it never stops being true.
  if (facts.securityHold) {
    reasons.push({ kind: 'security-hold' });
  }

  // The classic slopsquat shape: young and nobody uses it. Both halves are needed, since plenty of
  // new packages are legitimate and plenty of old ones are simply obscure.
  if (ageDays < MAX_AGE_DAYS && lastMonth < MIN_MONTHLY_DOWNLOADS) {
    reasons.push({ kind: 'new-and-unpopular', ageDays, downloads: lastMonth });
  }

  // No repository, one version ever, and almost nobody using it. A package with no history at all.
  // This catches what age misses once the package is older than thirty days.
  if (!facts.hasRepository && facts.versionCount === 1 && lastMonth < MIN_MONTHLY_DOWNLOADS) {
    reasons.push({ kind: 'no-track-record', downloads: lastMonth });
  }

  // A patch bump that suddenly ships three times the code. The payload has to live somewhere.
  const jump = sizeJump(facts.unpackedSize, facts.previousUnpackedSize, facts.latestIsSmallBump);
  if (jump) {
    reasons.push(jump);
  }

  // A change of publisher is the fingerprint of a stolen maintainer token, but on its own it is far
  // too noisy to act on: maintainer teams rotate publishers constantly. Measured against the 100
  // most depended-on packages, flagging drift alone false-positived on eight of them, including
  // redux (acemarke handing over to phryneas), mocha (a maintainer publishing by hand instead of
  // through CI) and tsup (which moved *to* CI, an improvement). A tool that cries wolf on redux is
  // uninstalled the same afternoon.
  //
  // So it only counts when something else already looks wrong. A new publisher whose release also
  // triples the size of the package is a different story from a new publisher shipping a normal
  // release, and it is the first one that looks like an injected payload.
  const drift = publisherDrift(facts.latestPublisher, facts.priorPublishers);
  if (drift && reasons.length > 0) {
    reasons.push(drift);
  }

  return reasons.length > 0 ? { kind: 'flagged', name, reasons } : { kind: 'clean', name };
}

/**
 * A change in the *class* of publisher, not merely the name. Packages are published either by a
 * machine (GitHub Actions, a release bot) or by a person, and that rarely changes. It changing is
 * the shape of a compromise.
 */
function publisherDrift(latest: string | null, prior: string[]): Reason | null {
  if (!latest || prior.length < 3) {
    return null;
  }

  const recent = prior.slice(-5);
  const machine = (name: string) => /github|actions|bot|ci|npm-cli|semantic-release/i.test(name);

  const allPriorWereMachines = recent.every(machine);
  const allPriorWereSamePerson = recent.every((p) => p === recent[0]) && !machine(recent[0]!);

  if (allPriorWereMachines && !machine(latest)) {
    return { kind: 'publisher-drift', before: recent[recent.length - 1]!, now: latest };
  }

  if (allPriorWereSamePerson && latest !== recent[0]) {
    return { kind: 'publisher-drift', before: recent[0]!, now: latest };
  }

  return null;
}

function sizeJump(now: number | null, before: number | null, smallBump: boolean): Reason | null {
  if (!smallBump || now === null || before === null || before === 0) {
    return null;
  }
  return now / before >= SIZE_JUMP_RATIO ? { kind: 'size-jump', before, now } : null;
}

/**
 * A package is only ever flagged on the download signal when it is unpopular, so a healthy download
 * count rules that out on its own. But the registry carries the signals that do not expire, so we
 * still need it. Fetch downloads first only to decide how much we care, not whether to look.
 */
export function needsRegistryLookup(downloads: DownloadsResult): boolean {
  if (downloads.kind === 'found') {
    return downloads.lastMonth < MIN_MONTHLY_DOWNLOADS;
  }
  return true;
}

/**
 * How many packages are checked at the same time. A commit that adds forty dependencies would
 * otherwise open eighty connections to npm at once, and the way that fails is a timeout, which
 * fails open and silently skips the check.
 */
const CONCURRENCY = 5;

/**
 * How closely to look.
 *
 * 'thorough' fetches the packument every time, which gives every signal including publisher drift.
 * It is right for the handful of packages a person or an agent explicitly asked for.
 *
 * 'quick' skips the packument for packages with healthy download counts. That matters because the
 * packument is the package's entire version history: 6.6MB for react. Fetching it for all 67
 * transitive dependencies of `express` would be slow enough to time out, and a timeout fails open,
 * which means the check silently does not happen. Better to check 67 packages quickly than to check
 * three thoroughly and give up on the rest.
 */
export type Depth = 'thorough' | 'quick';

/**
 * Checks every package. Order of the returned verdicts matches the order the names were first
 * seen, and repeated names are only checked once.
 */
export async function checkPackages(
  names: string[],
  config: Config,
  depth: Depth = 'thorough',
): Promise<Verdict[]> {
  const unique = [...new Set(names)];
  const now = new Date();
  const verdicts: Verdict[] = new Array(unique.length);

  let next = 0;
  async function worker(): Promise<void> {
    while (next < unique.length) {
      const index = next;
      next += 1;
      const name = unique[index]!;

      // One package failing unexpectedly must not take the others down with it. Without this, a
      // single bad name would lose every warning in the batch, including real ones.
      try {
        verdicts[index] = await checkOne(name, config, now, depth);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        verdicts[index] = { kind: 'skipped', name, reason };
      }
    }
  }

  const workers = Math.min(CONCURRENCY, unique.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));

  return verdicts;
}

async function checkOne(name: string, config: Config, now: Date, depth: Depth): Promise<Verdict> {
  const allowed = isAllowlisted(config, name);
  if (allowed.allowed) {
    return { kind: 'allowlisted', name, reason: allowed.reason };
  }

  // Never put an unvalidated name into a request URL. Dependency names come out of a package.json
  // that we did not write, and a name npm would refuse to install is not worth a network call.
  if (!isValidPackageName(name)) {
    return { kind: 'skipped', name, reason: 'not a valid npm package name' };
  }

  // A package that is malware in *every* version can be settled here, with no network at all. A
  // package where only some versions were compromised needs the version, so it falls through to
  // the registry lookup below.
  if (isKnownMalware(name, null)) {
    return { kind: 'flagged', name, reasons: [{ kind: 'known-malware' }] };
  }

  const downloads = await fetchDownloads(name);

  if (depth === 'quick' && !needsRegistryLookup(downloads)) {
    return { kind: 'clean', name };
  }

  const registry = await fetchRegistry(name);
  return evaluate(name, registry, downloads, config, now);
}
