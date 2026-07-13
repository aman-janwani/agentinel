import { checkPackages } from '../checks/package-guard/evaluate.js';
import { newStagedDependencies, repoRootOrCwd } from '../checks/package-guard/staged-deps.js';
import { loadConfig } from '../config/load.js';
import { formatVerdict } from '../output/format.js';
import { isRisky, type Verdict } from '../types.js';

/**
 * Scans dependencies newly added to any staged package.json, prints anything worth saying, and
 * reports whether something risky turned up.
 */
export async function scanStagedPackages(repoRoot: string): Promise<Verdict[]> {
  const candidates = newStagedDependencies(repoRoot);
  if (candidates.length === 0) {
    return [];
  }

  const config = loadConfig(repoRoot);
  return checkPackages(candidates, config);
}

export async function runPreCommitHook(): Promise<number> {
  const repoRoot = repoRootOrCwd();
  const verdicts = await scanStagedPackages(repoRoot);

  for (const verdict of verdicts) {
    const message = formatVerdict(verdict, process.stderr);
    if (message) {
      process.stderr.write(message + '\n');
    }
  }

  if (!verdicts.some(isRisky)) {
    return 0;
  }

  if (loadConfig(repoRoot).mode === 'strict') {
    process.stderr.write('commit blocked by agentsentinel (strict mode)\n');
    return 1;
  }

  return 0;
}
