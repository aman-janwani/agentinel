import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runAllow } from '../src/commands/allow.js';
import { ConfigError, loadConfig } from '../src/config/load.js';
import { isAllowlisted, parseConfig } from '../src/config/schema.js';

let dir: string;
let cwd: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'asen-cfg-'));
  cwd = process.cwd();
  process.chdir(dir);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  process.chdir(cwd);
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function readConfig(): { mode: string; allow: { name: string; reason: string }[] } {
  return JSON.parse(readFileSync(join(dir, '.agentsentinel.json'), 'utf8'));
}

describe('loadConfig', () => {
  it('defaults to warn mode with an empty allowlist when there is no config', () => {
    expect(loadConfig(dir)).toEqual({ mode: 'warn', allow: [] });
  });

  it('says so loudly when the config is not valid JSON, rather than ignoring it', () => {
    writeFileSync(join(dir, '.agentsentinel.json'), '{ broken', 'utf8');

    expect(() => loadConfig(dir)).toThrow(ConfigError);
  });

  it('falls back to defaults for fields it does not recognise', () => {
    const config = parseConfig({ mode: 'nonsense', allow: [{ noName: true }, 'junk'] });

    expect(config).toEqual({ mode: 'warn', allow: [] });
  });

  it('reads a strict mode config with an allowlist', () => {
    writeFileSync(
      join(dir, '.agentsentinel.json'),
      JSON.stringify({
        mode: 'strict',
        allow: [{ name: 'x', reason: 'mine', date: '2026-01-01' }],
      }),
      'utf8',
    );

    const config = loadConfig(dir);

    expect(config.mode).toBe('strict');
    expect(isAllowlisted(config, 'x')).toEqual({ allowed: true, reason: 'mine' });
    expect(isAllowlisted(config, 'y')).toEqual({ allowed: false });
  });
});

describe('runAllow', () => {
  it('refuses without a reason, so the allowlist is never a silent bypass', () => {
    expect(runAllow('my-pkg', undefined)).toBe(1);
    expect(runAllow('my-pkg', '   ')).toBe(1);
  });

  it('refuses without a package name', () => {
    expect(runAllow(undefined, 'a reason')).toBe(1);
  });

  it('records the package, the reason, and the date', () => {
    expect(runAllow('my-pkg', 'published by me')).toBe(0);

    const config = readConfig();
    expect(config.allow).toHaveLength(1);
    expect(config.allow[0]!.name).toBe('my-pkg');
    expect(config.allow[0]!.reason).toBe('published by me');
  });

  it('does not add the same package twice', () => {
    runAllow('my-pkg', 'first');
    runAllow('my-pkg', 'second');

    expect(readConfig().allow).toHaveLength(1);
  });

  it('keeps the existing mode when adding to the allowlist', () => {
    writeFileSync(join(dir, '.agentsentinel.json'), JSON.stringify({ mode: 'strict' }), 'utf8');

    runAllow('my-pkg', 'trusted');

    expect(readConfig().mode).toBe('strict');
  });
});
