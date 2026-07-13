import { checkPackages } from '../checks/package-guard/evaluate.js';
import { parseInstallCommand } from '../checks/package-guard/parse-install.js';
import { repoRootOrCwd } from '../checks/package-guard/staged-deps.js';
import { loadConfig } from '../config/load.js';
import { denyReason, formatVerdict } from '../output/format.js';
import { isRisky, type Verdict } from '../types.js';

/**
 * Claude Code PreToolUse hook. Reads the hook payload on stdin, and if the Bash command is an
 * npm install, checks every package it would install.
 *
 * The contract, from Claude Code's hooks docs: exit 0 printing nothing means "no decision, carry
 * on as normal", and exit 0 printing a permissionDecision of "deny" blocks the tool call. We never
 * exit non-zero, since a crashing hook should not be able to wedge someone's session.
 */
export async function runClaudeCodeHook(): Promise<void> {
  const payload = await readStdinJson();
  const command = extractCommand(payload);
  if (!command) {
    return;
  }

  const candidates = parseInstallCommand(command);
  if (candidates.length === 0) {
    return;
  }

  const repoRoot = typeof payload?.cwd === 'string' ? payload.cwd : repoRootOrCwd();
  const config = loadConfig(repoRoot);
  const verdicts = await checkPackages(candidates, config);
  const risky = verdicts.filter(isRisky);

  if (config.mode === 'strict' && risky.length > 0) {
    deny(denyReason(risky));
    return;
  }

  printWarnings(verdicts);
}

function printWarnings(verdicts: Verdict[]): void {
  for (const verdict of verdicts) {
    const message = formatVerdict(verdict);
    if (message) {
      // stderr, so it never gets confused with the decision JSON on stdout.
      process.stderr.write(message + '\n');
    }
  }
}

function deny(reason: string): void {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }) + '\n',
  );
}

function extractCommand(payload: Record<string, unknown> | null): string | null {
  if (!payload || payload.tool_name !== 'Bash') {
    return null;
  }
  const input = payload.tool_input;
  if (typeof input !== 'object' || input === null) {
    return null;
  }
  const command = (input as Record<string, unknown>).command;
  return typeof command === 'string' ? command : null;
}

async function readStdinJson(): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }

  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
