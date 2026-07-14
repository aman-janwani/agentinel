// Shared contracts between the package guard checks, the hooks, and the CLI commands.
// Everything here is deliberately plain data so each module stays independently testable.

export const MAX_AGE_DAYS = 30;
export const MIN_MONTHLY_DOWNLOADS = 1000;

/** A version whose unpacked size jumps by more than this on a patch or minor bump is suspect. */
export const SIZE_JUMP_RATIO = 3;

export type Mode = 'warn' | 'strict';

export interface AllowEntry {
  name: string;
  reason: string;
  date: string;
}

export interface Config {
  mode: Mode;
  allow: AllowEntry[];
}

/** What the registry knows about a package. Everything here is free, from one packument fetch. */
export interface PackageFacts {
  created: Date;
  /** The version npm would install. Needed to match the malware list, which records per version. */
  latestVersion: string | null;
  /** npm replaces a package it has taken down with a stub. This is npm saying "this is malware". */
  securityHold: boolean;
  versionCount: number;
  hasRepository: boolean;
  /** Who published the latest version. Often "GitHub Actions" for CI-published packages. */
  latestPublisher: string | null;
  /** Who published the versions before it. A change of publisher class is a takeover fingerprint. */
  priorPublishers: string[];
  unpackedSize: number | null;
  previousUnpackedSize: number | null;
  /** True when the latest version is only a patch or minor bump, so a size jump is meaningful. */
  latestIsSmallBump: boolean;
}

export type RegistryResult =
  | { kind: 'found'; facts: PackageFacts }
  | { kind: 'not-found' }
  | { kind: 'unavailable'; reason: string };

/**
 * What the downloads client found out about a package.
 *
 * 'no-data' is its own case on purpose. The downloads API 404s for a package it has never recorded
 * a download for, which for a package the registry says exists means nobody has installed it yet.
 * That is the single most suspicious state a package can be in, so it must not be confused with
 * 'unavailable', which means we genuinely could not find out.
 */
export type DownloadsResult =
  | { kind: 'found'; lastMonth: number }
  | { kind: 'no-data' }
  | { kind: 'unavailable'; reason: string };

/**
 * Why a package was flagged. A verdict carries a list of these, because "0 days old" and "npm has
 * taken this down for malware" are wildly different statements and lumping them together as
 * "suspicious" wastes the strongest signal we have.
 */
export type Reason =
  /** On the public malware list. Somebody has already confirmed this package is malicious. */
  | { kind: 'known-malware' }
  /** npm itself has taken the package down. Definitive, and it never expires. */
  | { kind: 'security-hold' }
  /** Young and unused. The classic slopsquat shape, but it stops working after 30 days. */
  | { kind: 'new-and-unpopular'; ageDays: number; downloads: number }
  /** The publisher changed class, for example CI-published for years and now a person. */
  | { kind: 'publisher-drift'; before: string; now: string }
  /** No repository link, one version ever, barely downloaded. A package with no history. */
  | { kind: 'no-track-record'; downloads: number }
  /** A patch bump that suddenly ships far more code. The payload has to land somewhere. */
  | { kind: 'size-jump'; before: number; now: number };

/** The verdict for a single candidate package. */
export type Verdict =
  | { kind: 'clean'; name: string }
  | { kind: 'allowlisted'; name: string; reason: string }
  | { kind: 'flagged'; name: string; reasons: Reason[] }
  | { kind: 'not-found'; name: string }
  | { kind: 'skipped'; name: string; reason: string };

/**
 * Whether a verdict is worth stopping for in strict mode. A skipped check is not: failing to
 * reach npm should never be the reason someone cannot commit or install.
 */
export function isRisky(verdict: Verdict): boolean {
  return verdict.kind === 'flagged' || verdict.kind === 'not-found';
}

/**
 * How serious a reason is. Known malware and an npm takedown are facts. The rest are suspicions,
 * and the output should not pretend otherwise.
 */
export function isConfirmed(reason: Reason): boolean {
  return reason.kind === 'known-malware' || reason.kind === 'security-hold';
}

export function hasConfirmedReason(verdict: Verdict): boolean {
  return verdict.kind === 'flagged' && verdict.reasons.some(isConfirmed);
}
