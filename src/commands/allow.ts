import { repoRootOrCwd } from '../checks/package-guard/staged-deps.js';
import { loadConfig, saveConfig } from '../config/load.js';

/**
 * Allowlisting is meant to leave a trail, not be a silent bypass, so the reason is required and
 * gets committed alongside the package name.
 */
export function runAllow(name: string | undefined, reason: string | undefined): number {
  if (!name) {
    console.error('usage: asen allow <pkg> --reason "why this package is trusted"');
    return 1;
  }

  if (!reason || reason.trim().length === 0) {
    console.error(
      `a reason is required, so anyone reading the config later knows why ${name} was trusted`,
    );
    console.error(`  asen allow ${name} --reason "published by me, expected to be new"`);
    return 1;
  }

  const repoRoot = repoRootOrCwd();
  const config = loadConfig(repoRoot);

  if (config.allow.some((entry) => entry.name === name)) {
    console.log(`${name} is already allowlisted`);
    return 0;
  }

  config.allow.push({
    name,
    reason: reason.trim(),
    date: new Date().toISOString().slice(0, 10),
  });
  saveConfig(repoRoot, config);

  console.log(`allowlisted ${name} in .agentsentinel.json`);
  return 0;
}
