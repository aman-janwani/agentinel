import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { spawn } from 'node:child_process';

/**
 * The URL where the GitHub Action pushes a freshly built malware list daily.
 * This is a stable URL pointing to the latest GitHub Release artifact.
 * It never changes — the Action overwrites the same release tag every day.
 * We never send any package names here. This is a one-way anonymous download of a static file.
 */
export const MALWARE_LIST_CDN_URL =
  'https://github.com/aman-janwani/agentinel/releases/download/malware-db-latest/malware-names.json.gz';

/** Minimum number of entries the list must contain to be considered valid. */
const MIN_VALID_ENTRIES = 200_000;

/** How long before we consider the cached list stale and attempt a background refresh. */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * When true, scheduleBackgroundRefresh() is a no-op.
 * Set this in tests to prevent background fetch calls from polluting fetch mocks.
 */
let disabledForTests = false;

/** Call in tests to suppress all background update activity. */
export function setUpdaterDisabledForTests(disabled: boolean): void {
  disabledForTests = disabled;
}

/**
 * The directory in the user's home folder where Agentinel stores its auto-updated malware list.
 * We write here (not inside node_modules) because:
 * 1. Global npm installs live in a root-owned directory — writing there would fail with EACCES.
 * 2. The home directory is always writable by the current user.
 */
export function agentinelDir(): string {
  return join(homedir(), '.agentinel');
}

export function cachedListPath(): string {
  return join(agentinelDir(), 'malware-names.json.gz');
}

function tmpListPath(): string {
  return join(agentinelDir(), 'malware-names.tmp.gz');
}

/**
 * Returns the path to the cached malware list if it exists, otherwise null.
 * This is called by malware.ts as the highest-priority source — before the bundled list.
 */
export function cachedListPathIfExists(): string | null {
  const p = cachedListPath();
  return existsSync(p) ? p : null;
}

/**
 * Returns true if the cached list on disk is older than STALE_AFTER_MS.
 * Returns true (treat as stale) if the file does not exist yet.
 */
export function isCacheStale(): boolean {
  const p = cachedListPath();
  if (!existsSync(p)) return true;
  try {
    const { mtimeMs } = statSync(p);
    return Date.now() - mtimeMs > STALE_AFTER_MS;
  } catch {
    return true;
  }
}

/**
 * Validates that a downloaded buffer is a valid, non-empty malware list.
 *
 * Two checks run:
 * 1. The buffer must be valid GZIP + JSON (gunzipSync + JSON.parse).
 * 2. The resulting list must have at least MIN_VALID_ENTRIES entries.
 *    This guards against an upstream OSV catastrophe (empty database, truncated download, etc.)
 *    that would silently zero out every user's protection.
 *
 * Returns the validated list on success, throws a descriptive Error on failure.
 */
export function validateDownload(buffer: Buffer): Record<string, string[]> {
  let raw: string;
  try {
    raw = gunzipSync(buffer).toString('utf8');
  } catch (err) {
    throw new Error(`Downloaded file is not valid GZIP: ${String(err)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Downloaded file decompressed but is not valid JSON: ${String(err)}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Downloaded file parsed but is not a JSON object');
  }

  const asObj = parsed as Record<string, unknown>;
  const count = Object.keys(asObj).length;
  if (count < MIN_VALID_ENTRIES) {
    throw new Error(
      `Downloaded malware list is suspiciously small (${count} entries, expected >${MIN_VALID_ENTRIES}). ` +
        `Upstream OSV may have a problem. Keeping existing list.`,
    );
  }

  // Validate that every value is an array of strings (not just any object).
  // A malformed or tampered download that passes the count check would otherwise crash
  // package checks at runtime when malware.ts calls .length or .includes on the value.
  for (const [key, val] of Object.entries(asObj)) {
    if (!Array.isArray(val) || (val as unknown[]).some((v) => typeof v !== 'string')) {
      throw new Error(
        `Downloaded malware list has an invalid entry for "${key}": expected string[], got ${JSON.stringify(val)}.`,
      );
    }
  }

  return asObj as Record<string, string[]>;
}

/**
 * Attempts to download the latest malware list from the CDN and atomically replace the cached
 * copy on disk.
 *
 * "Atomic" here means: download → temp file → verify → rename.
 * If the download or verification fails at any point, the temp file is cleaned up and the
 * existing cached list is left completely untouched. A failed update never corrupts the good list.
 *
 * All errors are caught and returned as Error objects rather than thrown, because this runs in the
 * background and must never crash the caller's process.
 */
export async function downloadAndReplace(
  url: string = MALWARE_LIST_CDN_URL,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const dir = agentinelDir();
  const tmp = tmpListPath();
  const final = cachedListPath();

  try {
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    return { ok: false, reason: `Could not create ${dir}: ${String(err)}` };
  }

  let buffer: Buffer;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { ok: false, reason: `CDN returned HTTP ${response.status}` };
    }
    buffer = Buffer.from(await response.arrayBuffer());
  } catch (err) {
    // Network errors: ENOTFOUND (offline), ETIMEDOUT, etc. Swallow silently.
    return { ok: false, reason: `Network error: ${String(err)}` };
  }

  try {
    validateDownload(buffer);
  } catch (err) {
    // Validation failed: corrupted download, suspiciously small list, etc.
    // Best-effort delete any leftover tmp file so nothing is left behind.
    try {
      if (existsSync(tmp)) rmSync(tmp, { force: true });
    } catch {
      // best effort
    }
    return { ok: false, reason: String(err) };
  }

  // Write to temp file first, then atomically rename. This guarantees that even if the process
  // is killed mid-write, the good list file is never left in a partially-written state.
  try {
    await writeFile(tmp, buffer);
    renameSync(tmp, final);
  } catch (err) {
    // Clean up the tmp file if the write or rename failed — never leave it behind.
    try {
      if (existsSync(tmp)) rmSync(tmp, { force: true });
    } catch {
      // best effort
    }
    return { ok: false, reason: `Could not write to disk: ${String(err)}` };
  }

  return { ok: true };
}

/**
 * Kicks off a background refresh if the cached list is stale.
 *
 * This is intentionally fire-and-forget:
 * - It does NOT await the download.
 * - It does NOT block the current package check in any way.
 * - If the update succeeds, the *next* invocation of Agentinel benefits from the fresh list.
 * - All errors are silently swallowed — an update failure must never surface to the developer.
 *
 * Think of it like an antivirus definition updater running in the background.
 */
export function scheduleBackgroundRefresh(url?: string): void {
  if (disabledForTests) return;
  if (!isCacheStale()) return;

  // Spawn a detached child process that does the download and exits.
  // Using a detached + unref'd child means the main CLI process exits immediately
  // after the current package check finishes — the update runs in the background
  // without keeping the Node.js event loop alive. This is the same technique that
  // package managers (npm, yarn) use for their own background update checks.
  try {
    const child = spawn(
      process.execPath, // the same `node` binary that is running right now
      [
        '--input-type=module',
        `--eval`,
        [
          `import { downloadAndReplace } from ${JSON.stringify(new URL('./updater.js', import.meta.url).href)};`,
          `await downloadAndReplace(${url ? JSON.stringify(url) : ''}).catch(() => {});`,
        ].join('\n'),
      ],
      {
        detached: true,
        stdio: 'ignore', // don't inherit stdin/stdout — this runs silently
      },
    );
    // unref() lets the parent process exit without waiting for this child.
    child.unref();
  } catch {
    // If spawn itself fails (e.g. corrupted Node install), swallow silently.
    // A broken updater must never crash the current package check.
  }
}
