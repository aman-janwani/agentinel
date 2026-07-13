import { checkPackages } from '../checks/package-guard/evaluate.js';
import { newStagedDependencies, repoRootOrCwd } from '../checks/package-guard/staged-deps.js';
import { loadConfig } from '../config/load.js';
import { formatVerdict } from '../output/format.js';

/**
 * Scans dependencies newly added to the staged package.json. Shared by the git pre-commit hook
 * and by `asen check`, which do the same work and differ only in what they do about it: the hook
 * can abort the commit in strict mode, `asen check` just reports.
 *
 * Returns true if anything risky was found.
 */
export async function scanStagedPackages(): Promise<boolean> {
  const repoRoot = repoRootOrCwd();
  const candidates = newStagedDependencies(repoRoot);
  if (candidates.length === 0) {
    return false;
  }

  const config = loadConfig(repoRoot);
  const verdicts = await checkPackages(candidates, config);

  let risky = false;
  for (const verdict of verdicts) {
    if (verdict.kind === 'flagged' || verdict.kind === 'not-found') {
      risky = true;
    }
    const message = formatVerdict(verdict);
    if (message) {
      process.stderr.write(message + '\n');
    }
  }

  return risky;
}

export async function runPreCommitHook(): Promise<number> {
  const risky = await scanStagedPackages();
  const config = loadConfig(repoRootOrCwd());

  if (risky && config.mode === 'strict') {
    process.stderr.write('commit blocked by agentsentinel (strict mode)\n');
    return 1;
  }

  return 0;
}
