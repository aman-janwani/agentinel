import { scan } from '../checks/package-guard/evaluate.js';
import { stagedLockfilePackages } from '../checks/package-guard/lockfile.js';
import { newStagedDependencies, repoRootOrCwd } from '../checks/package-guard/staged-deps.js';
import { loadConfig } from '../config/load.js';
import { formatVerdict } from '../output/format.js';
import { isRisky, type Verdict } from '../types.js';

/**
 * Checks the dependencies a commit would introduce.
 *
 * Two things are checked, which together give the same coverage the agent hooks have. The packages
 * newly named in a staged package.json get the full check, since a person chose to add them. And
 * every package in the staged lockfile is matched against the malware list, which catches a
 * poisoned transitive dependency that only ever appears in package-lock.json and would never show
 * up in a package.json diff.
 */
export async function scanStagedPackages(repoRoot: string): Promise<Verdict[]> {
  const named = newStagedDependencies(repoRoot);
  const tree = stagedLockfilePackages(repoRoot).filter((entry) => !named.includes(entry.name));

  if (named.length === 0 && tree.length === 0) {
    return [];
  }

  return scan(named, tree, loadConfig(repoRoot));
}

export async function runPreCommitHook(): Promise<number> {
  const repoRoot = repoRootOrCwd();
  const verdicts = await scanStagedPackages(repoRoot);

  for (const verdict of verdicts) {
    const message = formatVerdict(verdict, process.stderr);
    if (message) {
      process.stderr.write('\n' + message + '\n');
    }
  }

  if (!verdicts.some(isRisky)) {
    return 0;
  }

  if (loadConfig(repoRoot).mode === 'strict') {
    process.stderr.write('\ncommit blocked by agentinel (strict mode)\n');
    return 1;
  }

  return 0;
}
