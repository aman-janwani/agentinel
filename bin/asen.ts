import { positionals, readFlag } from '../src/cli/args.js';
import { runAllow } from '../src/commands/allow.js';
import { runCheck } from '../src/commands/check.js';
import { runInit } from '../src/commands/init.js';
import { runClaudeCodeHook } from '../src/hooks/claude-code.js';
import { runPreCommitHook } from '../src/hooks/pre-commit.js';
import { ConfigError } from '../src/config/load.js';

const USAGE = `asen, a guard for AI coding agent workflows

  asen init                          set up the hooks and config in this repo
  asen check [pkg...]                check staged dependencies, or specific packages
  asen allow <pkg> --reason "..."    allowlist a flagged package, with a logged reason
`;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  switch (command) {
    case 'init':
      return runInit();

    case 'check':
      return runCheck(positionals(rest));

    case 'allow':
      return runAllow(positionals(rest)[0], readFlag(rest, '--reason'));

    // Not documented in the usage text on purpose. These are what the installed hooks call.
    case 'hook':
      return runHook(rest[0]);

    case '--help':
    case '-h':
    case undefined:
      console.log(USAGE);
      return 0;

    default:
      console.error(`unknown command: ${command}\n`);
      console.error(USAGE);
      return 1;
  }
}

async function runHook(name: string | undefined): Promise<number> {
  if (name === 'claude-code') {
    await runClaudeCodeHook();
    return 0;
  }
  if (name === 'pre-commit') {
    return runPreCommitHook();
  }
  console.error(`unknown hook: ${name}`);
  return 1;
}

const argv = process.argv.slice(2);

/**
 * A hook must fail open. A bug in this tool should never be the reason someone cannot commit or
 * install, so an unexpected error there is reported and swallowed.
 *
 * Everywhere else a crash is a real failure and has to be visible. `asen check` is meant to be
 * usable as a CI step, and a crash that exits 0 would report a clean scan that never ran. This
 * also stops a genuine bug (init failing on a git worktree, say) from being mistaken for a
 * harmless skipped check.
 */
function failsOpen(args: string[]): boolean {
  return args[0] === 'hook';
}

main(argv)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);

    if (error instanceof ConfigError) {
      console.error(`agentinel: ${message}`);
      process.exitCode = failsOpen(argv) ? 0 : 1;
      return;
    }

    if (failsOpen(argv)) {
      console.error(`agentinel: check skipped (${message})`);
      process.exitCode = 0;
      return;
    }

    console.error(`agentinel: ${message}`);
    process.exitCode = 1;
  });
