import { checkPackages } from '../checks/package-guard/evaluate.js';
import { parseInstallCommand } from '../checks/package-guard/parse-install.js';
import { repoRootOrCwd } from '../checks/package-guard/staged-deps.js';
import { loadConfig } from '../config/load.js';
import { denyReason, plainSummary } from '../output/format.js';
import { isRisky, type Verdict } from '../types.js';

/**
 * Claude Code PreToolUse hook. Reads the hook payload on stdin, and if the Bash command is an
 * install, checks every package it would install.
 *
 * How Claude Code reads a hook, from the official docs, because getting this wrong makes the whole
 * feature silent: on exit 0 it parses **stdout** for JSON and **ignores stderr entirely**. So a
 * warning written to stderr is thrown away. Everything the user is meant to see goes in the JSON:
 *
 * - `systemMessage` is shown to the user. This is how warn mode gets seen at all.
 * - `additionalContext` is put in Claude's context, so the agent knows the package looked wrong and
 *   can reconsider rather than carrying on blindly.
 * - `permissionDecision: "deny"` blocks the call, and is only used in strict mode.
 *
 * We always exit 0. A crash in this tool must never wedge a session.
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
    emit({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: denyReason(risky),
      },
    });
    return;
  }

  warn(verdicts);
}

/**
 * Warn mode. No decision, so the install proceeds, but the user sees why it looked wrong and so
 * does Claude.
 */
function warn(verdicts: Verdict[]): void {
  const summary = plainSummary(verdicts);
  if (summary === null) {
    return;
  }

  emit({
    systemMessage: summary,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: summary,
    },
  });
}

function emit(output: unknown): void {
  process.stdout.write(JSON.stringify(output) + '\n');
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
