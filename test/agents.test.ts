import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runInit } from '../src/commands/init.js';
import { runAgentHook, type AgentKind } from '../src/hooks/agents.js';

/**
 * The payload each agent actually sends, verified against its docs. Getting a field name wrong here
 * is the whole failure mode being guarded against: the hook reads nothing, finds no command, says
 * nothing, and looks perfectly healthy while protecting no one.
 */
function payloadFor(kind: AgentKind, command: string, cwd: string): unknown {
  switch (kind) {
    case 'claude-code':
    case 'codex':
      return { tool_name: 'Bash', cwd, tool_input: { command } };
    case 'copilot':
      return { toolName: 'bash', cwd, toolArgs: { command } };
    case 'gemini':
      return { tool_name: 'run_shell_command', cwd, tool_input: { command } };
  }
}

/** Drives the hook the way the agent does: JSON on stdin, and only stdout is read back. */
async function runHook(
  kind: AgentKind,
  command: string,
  cwd: string,
): Promise<Record<string, unknown> | null> {
  const stdin = Readable.from([Buffer.from(JSON.stringify(payloadFor(kind, command, cwd)))]);
  vi.spyOn(process, 'stdin', 'get').mockReturnValue(stdin as unknown as typeof process.stdin);

  let written = '';
  const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    written += String(chunk);
    return true;
  });

  await runAgentHook(kind);
  write.mockRestore();

  return written.trim() ? JSON.parse(written.trim()) : null;
}

function stubNpm(downloads: number, createdDaysAgo: number): void {
  const created = new Date(Date.now() - createdDaysAgo * 86400000).toISOString();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.startsWith('https://api.npmjs.org/downloads/')) {
        return new Response(JSON.stringify({ downloads }));
      }
      return new Response(JSON.stringify({ time: { created } }));
    }),
  );
}

/** A repo of its own, so the mode under test is the mode the hook reads. */
function repoInMode(mode: 'warn' | 'strict'): string {
  const repo = mkdtempSync(join(tmpdir(), 'agentinel-'));
  writeFileSync(join(repo, '.agentinel.json'), JSON.stringify({ mode, allow: [] }), 'utf8');
  return repo;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('warn mode, where the install still proceeds', () => {
  it('gives Codex the warning as context, and no decision', async () => {
    stubNpm(4, 2);

    const output = await runHook('codex', 'npm i sketchy-pkg', repoInMode('warn'));
    const specific = output?.hookSpecificOutput as Record<string, unknown>;

    expect(specific.hookEventName).toBe('PreToolUse');
    expect(String(specific.additionalContext)).toContain('sketchy-pkg');
    expect(specific.permissionDecision).toBeUndefined();
  });

  it('shows Gemini the warning to the user, and no decision', async () => {
    stubNpm(4, 2);

    const output = await runHook('gemini', 'npm i sketchy-pkg', repoInMode('warn'));

    expect(String(output?.systemMessage)).toContain('SUSPICIOUS PACKAGE');
    expect(output?.decision).toBeUndefined();
  });

  it('asks the Copilot user, since Copilot has no way to warn without asking', async () => {
    // preToolUse documents no systemMessage and no additionalContext, only the permission fields. So
    // `ask` is the one channel that puts this in front of the person. It is not a block: they decide.
    stubNpm(4, 2);

    const output = await runHook('copilot', 'npm i sketchy-pkg', repoInMode('warn'));

    expect(output?.permissionDecision).toBe('ask');
    expect(String(output?.permissionDecisionReason)).toContain('sketchy-pkg');
  });

  it('keeps Claude Code exactly as it was, user and agent both told', async () => {
    stubNpm(4, 2);

    const output = await runHook('claude-code', 'npm i sketchy-pkg', repoInMode('warn'));
    const specific = output?.hookSpecificOutput as Record<string, unknown>;

    expect(String(output?.systemMessage)).toContain('sketchy-pkg');
    expect(String(specific.additionalContext)).toContain('sketchy-pkg');
    expect(specific.permissionDecision).toBeUndefined();
  });
});

describe('strict mode, where the call is denied', () => {
  it('denies for Codex in the shape Codex reads', async () => {
    stubNpm(4, 2);

    const output = await runHook('codex', 'npm i sketchy-pkg', repoInMode('strict'));
    const specific = output?.hookSpecificOutput as Record<string, unknown>;

    expect(specific.hookEventName).toBe('PreToolUse');
    expect(specific.permissionDecision).toBe('deny');
    expect(String(specific.permissionDecisionReason)).toContain('sketchy-pkg');
  });

  it('denies for Copilot in the shape Copilot reads', async () => {
    stubNpm(4, 2);

    const output = await runHook('copilot', 'npm i sketchy-pkg', repoInMode('strict'));

    expect(output?.permissionDecision).toBe('deny');
    expect(String(output?.permissionDecisionReason)).toContain('sketchy-pkg');
  });

  it('denies for Gemini in the shape Gemini reads', async () => {
    stubNpm(4, 2);

    const output = await runHook('gemini', 'npm i sketchy-pkg', repoInMode('strict'));

    expect(output?.decision).toBe('deny');
    expect(String(output?.reason)).toContain('sketchy-pkg');
    expect(String(output?.systemMessage)).toContain('sketchy-pkg');
  });

  it('denies for Claude Code in the shape Claude Code reads', async () => {
    stubNpm(4, 2);

    const output = await runHook('claude-code', 'npm i sketchy-pkg', repoInMode('strict'));
    const specific = output?.hookSpecificOutput as Record<string, unknown>;

    expect(specific.permissionDecision).toBe('deny');
    expect(String(specific.permissionDecisionReason)).toContain('sketchy-pkg');
  });
});

describe('staying out of the way', () => {
  const kinds: AgentKind[] = ['claude-code', 'codex', 'copilot', 'gemini'];

  it.each(kinds)('says nothing to %s about an established package', async (kind) => {
    stubNpm(50_000_000, 3000);

    expect(await runHook(kind, 'npm i react', repoInMode('warn'))).toBeNull();
  });

  it.each(kinds)('says nothing to %s for a command that is not an install', async (kind) => {
    stubNpm(4, 2);

    expect(await runHook(kind, 'npm run build', repoInMode('warn'))).toBeNull();
  });

  it('never prompts a Copilot user over a check that merely could not run', async () => {
    // A skipped check is worth a line in Claude Code, where it costs nothing. On Copilot the only
    // channel is `ask`, so the same line would interrupt the user to tell them nothing happened.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    );

    expect(await runHook('copilot', 'npm i sketchy-pkg', repoInMode('warn'))).toBeNull();
  });
});

describe('the Copilot fail-closed trap', () => {
  // Copilot is the one agent where a crash or any non-zero exit DENIES the tool call. A bug in this
  // tool would not be a missed check, it would be an agent that cannot run a single command. So the
  // hook has to swallow its own failures and stay silent, whatever happens.
  it('does not throw when the config it depends on is broken', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'agentinel-'));
    writeFileSync(join(repo, '.agentinel.json'), '{ this is not json', 'utf8');
    stubNpm(4, 2);

    await expect(runHook('copilot', 'npm i sketchy-pkg', repo)).resolves.toBeNull();
  });

  it('does not throw when the payload is not JSON at all', async () => {
    const stdin = Readable.from([Buffer.from('<html>a proxy ate the payload</html>')]);
    vi.spyOn(process, 'stdin', 'get').mockReturnValue(stdin as unknown as typeof process.stdin);

    await expect(runAgentHook('copilot')).resolves.toBeUndefined();
  });

  it('does not throw when the check itself blows up', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('boom');
      }),
    );

    await expect(
      runHook('copilot', 'npm i sketchy-pkg', repoInMode('strict')),
    ).resolves.not.toThrow();
  });
});

describe('wiring the agents into a repo', () => {
  let repo: string;
  let cwd: string;

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'asen-init-'));
    cwd = process.cwd();
    process.chdir(repo);
    execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });

    // The agents are wired only where there is evidence of them, so give the repo that evidence.
    // HOME is redirected too, so a machine that happens to run Codex cannot change the result.
    vi.stubEnv('HOME', repo);
    for (const dir of ['.codex', '.gemini', join('.github', 'hooks')]) {
      mkdirSync(join(repo, dir), { recursive: true });
    }
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(cwd);
    rmSync(repo, { recursive: true, force: true });
  });

  /** The shape each agent's own config file has, which is the thing under test. */
  interface Registered {
    matcher?: string;
    hooks?: { type?: string; command?: string }[];
  }
  interface AgentSettings {
    version?: number;
    theme?: string;
    hooks?: {
      PreToolUse?: Registered[];
      BeforeTool?: Registered[];
      preToolUse?: { type?: string; matcher?: string; bash?: string }[];
    };
  }

  function read(relativePath: string): AgentSettings {
    return JSON.parse(readFileSync(join(repo, relativePath), 'utf8')) as AgentSettings;
  }

  it('registers the hook in each agent config, in that agent own schema', () => {
    runInit();

    const codex = read('.codex/hooks.json').hooks?.PreToolUse?.[0];
    expect(codex?.matcher).toBe('Bash');
    expect(codex?.hooks?.[0]?.command).toContain('hook codex');

    const copilot = read('.github/hooks/agentinel.json');
    expect(copilot.version).toBe(1);
    expect(copilot.hooks?.preToolUse?.[0]?.bash).toContain('hook copilot');

    const gemini = read('.gemini/settings.json').hooks?.BeforeTool?.[0];
    expect(gemini?.matcher).toBe('run_shell_command');
    expect(gemini?.hooks?.[0]?.command).toContain('hook gemini');
  });

  it('adds no duplicate however many times it runs', () => {
    // A duplicate entry is not cosmetic. Every copy fires on every single command the agent runs.
    runInit();
    runInit();
    runInit();

    expect(read('.codex/hooks.json').hooks?.PreToolUse).toHaveLength(1);
    expect(read('.github/hooks/agentinel.json').hooks?.preToolUse).toHaveLength(1);
    expect(read('.gemini/settings.json').hooks?.BeforeTool).toHaveLength(1);
  });

  it('keeps what is already in those files', () => {
    writeFileSync(
      join(repo, '.gemini', 'settings.json'),
      JSON.stringify({ theme: 'dark', hooks: { BeforeTool: [{ matcher: 'write_file' }] } }),
      'utf8',
    );

    runInit();

    const gemini = read('.gemini/settings.json');
    expect(gemini.theme).toBe('dark');
    expect(gemini.hooks?.BeforeTool).toHaveLength(2);
  });

  it('leaves an agent alone when there is no sign of it', () => {
    rmSync(join(repo, '.codex'), { recursive: true, force: true });

    runInit();

    expect(existsSync(join(repo, '.codex'))).toBe(false);
  });
});
