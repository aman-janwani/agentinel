import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MALWARE_LIST_CDN_URL,
  agentinelDir,
  cachedListPath,
  cachedListPathIfExists,
  downloadAndReplace,
  isCacheStale,
  scheduleBackgroundRefresh,
  setUpdaterDisabledForTests,
  validateDownload,
} from '../src/updater.js';

// ─── Test Helpers ─────────────────────────────────────────────────────────────

/** Build a valid, correctly sized malware list buffer for use in tests. */
function buildValidGzip(entryCount = 210_000): Buffer {
  const list: Record<string, string[]> = {};
  for (let i = 0; i < entryCount; i++) {
    list[`fake-pkg-${i}`] = ['1.0.0'];
  }
  return gzipSync(JSON.stringify(list));
}

/** Build a small (invalid) malware list buffer. */
function buildSmallGzip(entryCount = 100): Buffer {
  const list: Record<string, string[]> = {};
  for (let i = 0; i < entryCount; i++) {
    list[`pkg-${i}`] = [];
  }
  return gzipSync(JSON.stringify(list));
}

// ─── Mock node:child_process so we can intercept spawn() calls ──────────────
// vi.spyOn cannot redefine ESM namespace exports, so we use vi.hoisted + vi.mock.
const mockChild = vi.hoisted(() => ({
  unref: vi.fn(),
}));
const mockSpawn = vi.hoisted(() => vi.fn().mockReturnValue(mockChild));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: mockSpawn };
});

// ─── Override HOME dir so tests never touch the real ~/.agentinel ──────────────
let testHome: string;

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: () => testHome,
  };
});

beforeEach(() => {
  testHome = join(tmpdir(), `agentinel-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testHome, { recursive: true });
  // Prevent background refresh from firing and polluting fetch mocks in tests.
  setUpdaterDisabledForTests(true);
  // Reset the spawn mock between tests.
  mockSpawn.mockClear();
  mockChild.unref.mockClear();
  mockSpawn.mockReturnValue(mockChild);
});

afterEach(() => {
  setUpdaterDisabledForTests(false);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('agentinelDir()', () => {
  it('points inside the home directory', () => {
    expect(agentinelDir()).toBe(join(testHome, '.agentinel'));
  });
});

describe('cachedListPathIfExists()', () => {
  it('returns null when no cached list has been downloaded yet', () => {
    expect(cachedListPathIfExists()).toBeNull();
  });

  it('returns the path once a file is written there', () => {
    const dir = agentinelDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(cachedListPath(), Buffer.from('dummy'));
    expect(cachedListPathIfExists()).toBe(cachedListPath());
  });
});

describe('isCacheStale()', () => {
  it('returns true when no cached file exists', () => {
    expect(isCacheStale()).toBe(true);
  });

  it('returns false when the cached file was just written (< 24h)', () => {
    const dir = agentinelDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(cachedListPath(), Buffer.from('dummy'));
    expect(isCacheStale()).toBe(false);
  });

  it('returns true when the cached file is older than 24 hours', async () => {
    const dir = agentinelDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(cachedListPath(), Buffer.from('dummy'));

    // Backdate the file's mtime to 25 hours ago using utimesSync.
    // This avoids the ESM module-namespace limitation that prevents spying on statSync.
    const staleTime = new Date(Date.now() - 25 * 60 * 60 * 1000);
    utimesSync(cachedListPath(), staleTime, staleTime);

    expect(isCacheStale()).toBe(true);
  });
});

describe('validateDownload()', () => {
  it('accepts a valid, correctly sized malware list', () => {
    const buf = buildValidGzip();
    expect(() => validateDownload(buf)).not.toThrow();
    const result = validateDownload(buf);
    expect(Object.keys(result).length).toBeGreaterThanOrEqual(200_000);
  });

  it('throws when the buffer is not valid GZIP', () => {
    const corrupt = Buffer.from('this is not gzip');
    expect(() => validateDownload(corrupt)).toThrow(/not valid GZIP/);
  });

  it('throws when the GZIP decompresses to invalid JSON', () => {
    const badJson = gzipSync(Buffer.from('{ not json }'));
    expect(() => validateDownload(badJson)).toThrow(/not valid JSON/);
  });

  it('throws when the GZIP decompresses to a JSON array (not an object)', () => {
    const array = gzipSync(Buffer.from('[]'));
    expect(() => validateDownload(array)).toThrow(/not a JSON object/);
  });

  it('throws when the list has fewer than 200k entries (suspiciously small)', () => {
    const small = buildSmallGzip(50);
    expect(() => validateDownload(small)).toThrow(/suspiciously small/);
  });

  it('includes the actual entry count in the error message', () => {
    const small = buildSmallGzip(42);
    expect(() => validateDownload(small)).toThrow(/42 entries/);
  });

  it('throws when an entry value is not an array (tampered/malformed download)', () => {
    // Build a list that passes the entry count but has a non-array value.
    const list: Record<string, unknown> = {};
    for (let i = 0; i < 200_001; i++) list[`pkg-${i}`] = ['1.0.0'];
    list['bad-pkg'] = 'not-an-array'; // tampered
    const buf = gzipSync(JSON.stringify(list));
    expect(() => validateDownload(buf)).toThrow(/invalid entry/);
    expect(() => validateDownload(buf)).toThrow(/bad-pkg/);
  });

  it('throws when an entry value is an array but contains non-strings', () => {
    const list: Record<string, unknown> = {};
    for (let i = 0; i < 200_001; i++) list[`pkg-${i}`] = ['1.0.0'];
    list['bad-pkg'] = [1, 2, 3]; // numbers instead of version strings
    const buf = gzipSync(JSON.stringify(list));
    expect(() => validateDownload(buf)).toThrow(/invalid entry/);
  });
});

describe('downloadAndReplace()', () => {
  it('downloads, validates, and atomically writes the file on success', async () => {
    const buf = buildValidGzip();

    // Stub fetch to return a valid buffer.
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    }));

    const result = await downloadAndReplace('https://fake-cdn/malware.gz');
    expect(result.ok).toBe(true);
    expect(existsSync(cachedListPath())).toBe(true);

    // The written file should be valid and parseable.
    const written = readFileSync(cachedListPath());
    const parsed = JSON.parse(gunzipSync(written).toString('utf8'));
    expect(Object.keys(parsed).length).toBeGreaterThanOrEqual(200_000);
  });

  it('returns ok:false and leaves disk untouched when the CDN returns an HTTP error', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 503 }));

    const result = await downloadAndReplace('https://fake-cdn/malware.gz');
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toMatch(/HTTP 503/);
    expect(existsSync(cachedListPath())).toBe(false);
  });

  it('returns ok:false and leaves disk untouched when the network is offline (ENOTFOUND)', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('ENOTFOUND fake-cdn');
    });

    const result = await downloadAndReplace('https://fake-cdn/malware.gz');
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toMatch(/Network error/);
    expect(existsSync(cachedListPath())).toBe(false);
  });

  it('returns ok:false and leaves the existing good file untouched when download is corrupted', async () => {
    // First write a known-good list.
    const goodBuf = buildValidGzip();
    mkdirSync(agentinelDir(), { recursive: true });
    writeFileSync(cachedListPath(), goodBuf);

    // Now fetch returns corrupt data.
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => {
        const corrupt = Buffer.from('definitely not gzip');
        return corrupt.buffer;
      },
    }));

    const result = await downloadAndReplace('https://fake-cdn/malware.gz');
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toMatch(/not valid GZIP/);

    // The good file must still be intact.
    const onDisk = readFileSync(cachedListPath());
    expect(onDisk.equals(goodBuf)).toBe(true);
  });

  it('returns ok:false and leaves the existing good file untouched when list is suspiciously small', async () => {
    // First write a known-good list.
    const goodBuf = buildValidGzip();
    mkdirSync(agentinelDir(), { recursive: true });
    writeFileSync(cachedListPath(), goodBuf);

    // Now fetch returns a tiny list (upstream OSV bug).
    const smallBuf = buildSmallGzip(5);
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        smallBuf.buffer.slice(smallBuf.byteOffset, smallBuf.byteOffset + smallBuf.byteLength),
    }));

    const result = await downloadAndReplace('https://fake-cdn/malware.gz');
    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toMatch(/suspiciously small/);

    // The good file must still be intact.
    const onDisk = readFileSync(cachedListPath());
    expect(onDisk.equals(goodBuf)).toBe(true);
  });

  it('does not leave a .tmp file behind after a failed download', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 500 }));
    await downloadAndReplace('https://fake-cdn/malware.gz');

    const tmpPath = join(agentinelDir(), 'malware-names.tmp.gz');
    expect(existsSync(tmpPath)).toBe(false);
  });

  it('does not leave a .tmp file behind after validation fails (corrupt data)', async () => {
    // Fetch succeeds but the data is garbage — validation should clean up any temp file.
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => Buffer.from('not gzip at all').buffer,
    }));

    await downloadAndReplace('https://fake-cdn/malware.gz');

    const tmpPath = join(agentinelDir(), 'malware-names.tmp.gz');
    expect(existsSync(tmpPath)).toBe(false);
  });

  it('returns ok:false gracefully when the response body is zero bytes', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(0),
    }));

    const result = await downloadAndReplace('https://fake-cdn/malware.gz');
    expect(result.ok).toBe(false);
    // Zero bytes is not valid GZIP — should surface the GZIP error.
    expect((result as { ok: false; reason: string }).reason).toMatch(/not valid GZIP/);
  });
});

describe('scheduleBackgroundRefresh()', () => {
  it('does nothing when the cache is fresh (no child spawned)', async () => {
    // Write a fresh file so isCacheStale() returns false.
    mkdirSync(agentinelDir(), { recursive: true });
    writeFileSync(cachedListPath(), buildValidGzip());

    // Re-enable the updater just for this test.
    setUpdaterDisabledForTests(false);
    scheduleBackgroundRefresh();

    // Give microtasks a tick.
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('spawns a detached child when the cache is stale', () => {
    // Re-enable the updater just for this test. No cached file → stale.
    setUpdaterDisabledForTests(false);
    scheduleBackgroundRefresh();

    // scheduleBackgroundRefresh is synchronous — spawn is called immediately.
    expect(mockSpawn).toHaveBeenCalledOnce();
    expect(mockChild.unref).toHaveBeenCalledOnce(); // must unref so parent can exit

    // The command should use --input-type=module so it can import the ESM updater.
    const [, args] = mockSpawn.mock.calls[0] as [string, string[], unknown];
    expect(args).toContain('--input-type=module');
  });

  it('never throws even when spawn fails', () => {
    setUpdaterDisabledForTests(false);
    // Make spawn throw to simulate a broken Node env.
    mockSpawn.mockImplementationOnce(() => {
      throw new Error('spawn failed');
    });

    // scheduleBackgroundRefresh must swallow the error — a broken updater
    // must never crash the CLI that is currently checking a package.
    expect(() => scheduleBackgroundRefresh()).not.toThrow();
  });
});

describe('CDN URL', () => {
  it('is a stable GitHub Release URL pointing to the malware-db-latest tag', () => {
    expect(MALWARE_LIST_CDN_URL).toContain('malware-db-latest');
    expect(MALWARE_LIST_CDN_URL).toContain('malware-names.json.gz');
    expect(MALWARE_LIST_CDN_URL).toMatch(/^https:\/\//);
  });
});
