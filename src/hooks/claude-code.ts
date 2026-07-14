import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { scan } from '../checks/package-guard/evaluate.js';
import { packagesInLockfile } from '../checks/package-guard/lockfile.js';
import { parseCommand } from '../checks/package-guard/parse-install.js';
import { resolveInstall, type Resolved } from '../checks/package-guard/resolve.js';
import { repoRootOrCwd } from '../checks/package-guard/staged-deps.js';
import { loadConfig } from '../config/load.js';
import { denyReason, plainSummary } from '../output/format.js';
import { isRisky, type Verdict } from '../types.js';

/**
 * Claude Code PreToolUse hook. Reads the hook payload on stdin and checks whatever the command
 * would pull from the npm registry.
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
 * We always exit 0. A crash in this tool must never wedge a session, and Copilot's hook contract
 * treats any non-zero exit as a denial, so exiting non-zero would break that agent outright.
 */
export async function runClaudeCodeHook(): Promise<void> {
  const payload = await readStdinJson();
  const command = extractCommand(payload);
  if (!command) {
    return;
  }

  const repoRoot = typeof payload?.cwd === 'string' ? payload.cwd : repoRootOrCwd();
  const { named, tree } = candidatesFor(command, repoRoot);
  if (named.length === 0 && tree.length === 0) {
    return;
  }

  const config = loadConfig(repoRoot);
  const verdicts = await scan(named, tree, config);
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
 * Everything worth checking for this command.
 *
 * Three ways a command reaches the registry, and all three used to be handled badly:
 *
 * - it names packages to install, which is the obvious one
 * - it names a package to **run right now** (`npx`, `bunx`, `dlx`). Nothing is written to
 *   package.json, so the pre-commit hook never sees it either. This is the sharpest case and we
 *   used to ignore it completely
 * - it names nothing and installs the lockfile (`npm ci`, a bare `npm install`), which is what
 *   happens on a fresh clone of a repo whose lockfile is already poisoned
 */
export function candidatesFor(
  command: string,
  repoRoot: string,
): { named: string[]; tree: Resolved[] } {
  const intent = parseCommand(command);

  // A locally installed tool (`npx tsc`, `npx vitest`) is not fetched from the registry at all, so
  // checking it would only produce noise, and a private workspace tool would be reported as not
  // existing on npm, which is a false alarm of the worst kind.
  const executes = intent.executes.filter((name) => !isLocalTool(repoRoot, name));

  const named = [...new Set([...intent.installs, ...executes])];

  // What the install would ACTUALLY bring in. `npm install express` names one package and installs
  // 67, and most real npm malware hides in the transitive ones. Checking only the name that was
  // typed means checking 1 package out of 67 and calling the result safe.
  const resolved = intent.installs.length > 0 ? resolveInstall(repoRoot, intent.installs) : [];
  const fromLockfile = intent.lockfile ? packagesInLockfile(repoRoot) : [];

  const tree = new Map<string, Resolved>();
  for (const entry of [...resolved, ...fromLockfile]) {
    if (!named.includes(entry.name)) {
      tree.set(entry.name, entry);
    }
  }

  return { named, tree: [...tree.values()] };
}

function isLocalTool(repoRoot: string, name: string): boolean {
  const binary = name.includes('/') ? name.split('/').pop()! : name;
  return existsSync(join(repoRoot, 'node_modules', '.bin', binary));
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
