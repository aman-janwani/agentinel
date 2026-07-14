import { checkPackages } from '../checks/package-guard/evaluate.js';
import { newStagedDependencies, repoRootOrCwd } from '../checks/package-guard/staged-deps.js';
import { loadConfig } from '../config/load.js';
import { formatVerdict } from '../output/format.js';
import { isRisky } from '../types.js';

/**
 * Manual scan of newly added dependencies. Same check the hooks run, but always reports rather
 * than blocking, so it is safe to run any time.
 */
export async function runCheck(names: string[]): Promise<number> {
  const repoRoot = repoRootOrCwd();
  const candidates = names.length > 0 ? names : newStagedDependencies(repoRoot);

  if (candidates.length === 0) {
    console.log('no new packages to check');
    return 0;
  }

  const config = loadConfig(repoRoot);
  const verdicts = await checkPackages(candidates, config);

  let risky = 0;
  let skipped = 0;
  for (const verdict of verdicts) {
    if (isRisky(verdict)) {
      risky += 1;
    }
    if (verdict.kind === 'skipped') {
      skipped += 1;
    }
    const message = formatVerdict(verdict);
    if (message) {
      console.log('');
      console.log(message);
    }
  }

  if (risky === 0) {
    // Never say "nothing suspicious" about a package we did not actually manage to check. That
    // reads as a clean bill of health for a check that never ran.
    const checked = verdicts.length - skipped;
    if (skipped > 0) {
      console.log(
        `checked ${checked} package(s), nothing suspicious. ${skipped} could not be checked`,
      );
    } else {
      console.log(`checked ${checked} package(s), nothing suspicious`);
    }
    return 0;
  }

  // Non-zero so this can gate a CI job. The hooks decide separately whether to block, based on
  // the configured mode, and they do not go through here.
  return 1;
}
