import { checkPackages, scanForKnownMalware } from '../checks/package-guard/evaluate.js';
import { repoRootOrCwd } from '../checks/package-guard/staged-deps.js';
import { loadConfig } from '../config/load.js';
import { denyReason, plainSummary } from '../output/format.js';
import { isRisky, type Verdict } from '../types.js';
import { candidatesFor } from './claude-code.js';

/**
 * The CLI agents we can hook into. All four fire a blocking hook before a tool runs, read JSON on
 * stdin and JSON on stdout, and let that JSON deny the call. Only the field names differ, so the
 * decision is made once here and only the emitted shape changes.
 *
 * Verified against the official docs, since a wrong field name fails silently rather than loudly:
 *
 * - Claude Code: PreToolUse, `tool_name`/`tool_input`, `hookSpecificOutput.permissionDecision`
 * - Codex:    https://learn.chatgpt.com/docs/hooks
 * - Copilot:  https://docs.github.com/en/copilot/reference/hooks-configuration
 * - Gemini:   https://geminicli.com/docs/hooks/reference/
 */
export type AgentKind = 'claude-code' | 'codex' | 'copilot' | 'gemini';

export const AGENT_KINDS: readonly AgentKind[] = ['claude-code', 'codex', 'copilot', 'gemini'];

export function isAgentKind(value: string): value is AgentKind {
  return (AGENT_KINDS as readonly string[]).includes(value);
}

/**
 * The names each agent gives its shell tool. Claude Code and Codex call it `Bash`, Copilot calls it
 * `bash`, Gemini calls it `run_shell_command`. Matching the whole set for every agent costs nothing
 * and means a renamed tool degrades into a check we still run, rather than one we silently skip.
 */
const SHELL_TOOLS = new Set(['bash', 'shell', 'run_shell_command', 'execute_bash']);

interface Shape {
  /** Where this agent puts the tool name and the command it wants to run. */
  command(payload: Record<string, unknown>): string | null;
  /** Warn mode: the install proceeds. Null when this agent has nothing worth emitting. */
  warn(summary: string, risky: boolean): unknown | null;
  /** Strict mode: block the call. */
  deny(reason: string): unknown;
}

const SHAPES: Record<AgentKind, Shape> = {
  // stdout JSON on exit 0. `systemMessage` reaches the user, `additionalContext` reaches the model.
  'claude-code': {
    command: (payload) => snakeCommand(payload),
    warn: (summary) => ({
      systemMessage: summary,
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: summary },
    }),
    deny: (reason) => ({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  },

  // Same envelope as Claude Code, and the same snake_case payload. Codex documents
  // `additionalContext` but no user-facing message field, so in warn mode the agent is told and the
  // user reads it through the agent.
  codex: {
    command: (payload) => snakeCommand(payload),
    warn: (summary) => ({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: summary },
    }),
    deny: (reason) => ({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  },

  // camelCase payload, and permission fields are the only documented output: there is no
  // `additionalContext` or `systemMessage` on preToolUse. So warn mode uses `ask`, the one channel
  // that puts our text in front of the person before the install runs. It is not a block, the user
  // decides. A clean or merely skipped check stays silent, so nothing extra is ever prompted for.
  copilot: {
    command: (payload) => camelCommand(payload),
    warn: (summary, risky) =>
      risky ? { permissionDecision: 'ask', permissionDecisionReason: summary } : null,
    deny: (reason) => ({ permissionDecision: 'deny', permissionDecisionReason: reason }),
  },

  // BeforeTool. A flat `decision`/`reason` pair rather than an envelope, and `systemMessage` is
  // shown to the user immediately, which is what carries warn mode here.
  gemini: {
    command: (payload) => snakeCommand(payload),
    warn: (summary) => ({ systemMessage: summary }),
    deny: (reason) => ({ decision: 'deny', reason, systemMessage: reason }),
  },
};

/**
 * The hook body for every agent.
 *
 * Nothing thrown out of here, ever. Copilot fails **closed**: any crash or non-zero exit from a
 * preToolUse hook denies the tool call outright, so a bug in this tool would leave a Copilot user
 * with an agent that cannot run a single command. The other three fail open, which is merely
 * silent. So a check we cannot complete is a check we skip, never an error we surface.
 */
export async function runAgentHook(kind: AgentKind): Promise<void> {
  try {
    await check(kind);
  } catch (error) {
    // stderr, not stdout: stdout is the decision channel, and a half written or unparseable
    // decision is exactly what we must not send.
    process.stderr.write(`agentinel: check skipped (${describe(error)})\n`);
  }
}

async function check(kind: AgentKind): Promise<void> {
  const shape = SHAPES[kind];

  const payload = await readStdinJson();
  if (!payload) {
    return;
  }

  const command = shape.command(payload);
  if (!command) {
    return;
  }

  const repoRoot = typeof payload.cwd === 'string' ? payload.cwd : repoRootOrCwd();
  const { named, tree } = candidatesFor(command, repoRoot);
  if (named.length === 0 && tree.length === 0) {
    return;
  }

  const config = loadConfig(repoRoot);

  // The same split the Claude Code hook makes: the handful of packages the command names get the
  // full network check, and the rest of the resolved tree is matched against the local malware list,
  // which is instant and version exact.
  const namedVerdicts = await checkPackages(named, config, 'thorough');
  const treeVerdicts = scanForKnownMalware(tree, config);

  const verdicts: Verdict[] = [...namedVerdicts, ...treeVerdicts];
  const risky = verdicts.filter(isRisky);

  if (config.mode === 'strict' && risky.length > 0) {
    emit(shape.deny(denyReason(risky)));
    return;
  }

  const summary = plainSummary(verdicts);
  if (summary === null) {
    return;
  }

  const output = shape.warn(summary, risky.length > 0);
  if (output !== null) {
    emit(output);
  }
}

/** Claude Code, Codex and Gemini: `tool_name` plus a `tool_input` object. */
function snakeCommand(payload: Record<string, unknown>): string | null {
  return shellCommand(payload.tool_name, payload.tool_input);
}

/** Copilot: `toolName` plus `toolArgs`. */
function camelCommand(payload: Record<string, unknown>): string | null {
  return shellCommand(payload.toolName, payload.toolArgs);
}

function shellCommand(toolName: unknown, args: unknown): string | null {
  if (typeof toolName !== 'string' || !SHELL_TOOLS.has(toolName.toLowerCase())) {
    return null;
  }
  if (typeof args !== 'object' || args === null) {
    return null;
  }

  const command = (args as Record<string, unknown>).command;
  if (typeof command === 'string') {
    return command;
  }

  // Some shells are handed an argv array rather than a line.
  if (Array.isArray(command) && command.every((part) => typeof part === 'string')) {
    return command.join(' ');
  }

  return null;
}

function emit(output: unknown): void {
  process.stdout.write(JSON.stringify(output) + '\n');
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

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
