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
      return runCheck(rest.filter((arg) => !arg.startsWith('-')));

    case 'allow':
      return runAllow(
        rest.find((arg) => !arg.startsWith('-')),
        readFlag(rest, '--reason'),
      );

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

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index !== -1) {
    return args[index + 1];
  }
  const inline = args.find((arg) => arg.startsWith(`${flag}=`));
  return inline ? inline.slice(flag.length + 1) : undefined;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    if (error instanceof ConfigError) {
      console.error(`agentsentinel: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    // Anything unexpected fails open. A bug in this tool should never be the reason someone
    // cannot commit or install.
    console.error(
      `agentsentinel: check skipped (${error instanceof Error ? error.message : String(error)})`,
    );
    process.exitCode = 0;
  });
