import { repoRootOrCwd } from '../checks/package-guard/staged-deps.js';
import { loadConfig, saveConfig } from '../config/load.js';

export function runMode(targetMode: string | undefined): number {
  if (targetMode !== 'warn' && targetMode !== 'strict') {
    console.error('usage: asen mode <warn|strict>');
    return 1;
  }

  const repoRoot = repoRootOrCwd();
  const config = loadConfig(repoRoot);

  if (config.mode === targetMode) {
    console.log(`mode is already ${targetMode}`);
    return 0;
  }

  config.mode = targetMode;
  saveConfig(repoRoot, config);

  console.log(`set mode to ${targetMode} in .agentinel.json`);
  return 0;
}
