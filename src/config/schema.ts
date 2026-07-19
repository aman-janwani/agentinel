import type { Config } from '../types.js';

export const CONFIG_FILENAME = '.agentinel.json';

export function defaultConfig(): Config {
  return {
    mode: 'strict',
    allow: [
      {
        name: 'asen',
        reason: 'Agentinel CLI tool',
        date: new Date().toISOString().substring(0, 10),
      },
      {
        name: 'agentinel',
        reason: 'Agentinel package',
        date: new Date().toISOString().substring(0, 10),
      },
    ],
  };
}

/**
 * Turns whatever was in the config file into a Config we can trust.
 *
 * Anything unrecognised falls back to the default rather than throwing, so a slightly malformed
 * file never breaks someone's commit. A file that isn't valid JSON at all is a different case and
 * is reported by the loader.
 *
 * `warn` is called for anything that was ignored. A mode of "block", which is a natural thing to
 * guess, would otherwise fall back to strict in silence, causing confusion.
 */
export function parseConfig(raw: unknown, warn: (message: string) => void = () => {}): Config {
  const config = defaultConfig();
  if (typeof raw !== 'object' || raw === null) {
    return config;
  }

  const source = raw as Record<string, unknown>;
  if (source.mode === 'strict' || source.mode === 'warn') {
    config.mode = source.mode;
  } else if (source.mode !== undefined) {
    warn(
      `unknown mode ${JSON.stringify(source.mode)} in ${CONFIG_FILENAME}, ` +
        'falling back to "strict". Valid modes are "warn" and "strict".',
    );
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
