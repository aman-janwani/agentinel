import type { Config } from '../types.js';

export const CONFIG_FILENAME = '.agentsentinel.json';

export function defaultConfig(): Config {
  return { mode: 'warn', allow: [] };
}

/**
 * Turns whatever was in the config file into a Config we can trust.
 * Anything unrecognised falls back to the default rather than throwing, so a slightly
 * malformed file never breaks someone's commit. A file that isn't valid JSON at all is a
 * different case and is reported by the loader.
 */
export function parseConfig(raw: unknown): Config {
  const config = defaultConfig();
  if (typeof raw !== 'object' || raw === null) {
    return config;
  }

  const source = raw as Record<string, unknown>;
  if (source.mode === 'strict' || source.mode === 'warn') {
    config.mode = source.mode;
  }

  if (Array.isArray(source.allow)) {
    for (const entry of source.allow) {
      if (typeof entry !== 'object' || entry === null) continue;
      const { name, reason, date } = entry as Record<string, unknown>;
      if (typeof name !== 'string' || name.length === 0) continue;
      config.allow.push({
        name,
        reason: typeof reason === 'string' ? reason : '',
        date: typeof date === 'string' ? date : '',
      });
    }
  }

  return config;
}

export function isAllowlisted(config: Config, name: string): AllowLookup {
  const entry = config.allow.find((candidate) => candidate.name === name);
  return entry ? { allowed: true, reason: entry.reason } : { allowed: false };
}

export type AllowLookup = { allowed: true; reason: string } | { allowed: false };
