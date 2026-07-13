import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from '../types.js';
import { CONFIG_FILENAME, defaultConfig, parseConfig } from './schema.js';

export class ConfigError extends Error {}

export function configPath(repoRoot: string): string {
  return join(repoRoot, CONFIG_FILENAME);
}

/**
 * Reads .agentsentinel.json from the repo. A missing file is normal, it just means the
 * defaults apply. A file that exists but isn't valid JSON is a real problem worth saying out
 * loud, since silently ignoring it would hide someone's allowlist.
 */
export function loadConfig(repoRoot: string): Config {
  const path = configPath(repoRoot);
  if (!existsSync(path)) {
    return defaultConfig();
  }

  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new ConfigError(`could not read ${CONFIG_FILENAME}: ${describe(error)}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ConfigError(`${CONFIG_FILENAME} is not valid JSON, fix it or delete it`);
  }

  // Anything the config file got wrong is said out loud. Silently ignoring it is how someone ends
  // up believing they are in strict mode when they are not.
  return parseConfig(raw, (message) => process.stderr.write(`agentsentinel: ${message}\n`));
}

export function saveConfig(repoRoot: string, config: Config): void {
  writeFileSync(configPath(repoRoot), JSON.stringify(config, null, 2) + '\n', 'utf8');
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
