// Shared contracts between the package guard checks, the hooks, and the CLI commands.
// Everything here is deliberately plain data so each module stays independently testable.

export const MAX_AGE_DAYS = 30;
export const MIN_MONTHLY_DOWNLOADS = 1000;

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

/** What the registry client found out about a package. */
export type RegistryResult =
  | { kind: 'found'; created: Date }
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

/** The verdict for a single candidate package. */
export type Verdict =
  | { kind: 'clean'; name: string }
  | { kind: 'allowlisted'; name: string; reason: string }
  | { kind: 'flagged'; name: string; ageDays: number; downloads: number }
  | { kind: 'not-found'; name: string }
  | { kind: 'skipped'; name: string; reason: string };
