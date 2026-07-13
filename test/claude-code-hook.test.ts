import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runClaudeCodeHook } from '../src/hooks/claude-code.js';

/**
 * Drives the hook exactly as Claude Code does: payload on stdin, and whatever lands on stdout is
 * the only thing Claude Code reads. Exit 0 with output on stderr is discarded by Claude Code, so
 * these tests deliberately assert on stdout alone.
 */
async function runHook(command: string, cwd: string): Promise<Record<string, unknown> | null> {
  const payload = JSON.stringify({ tool_name: 'Bash', cwd, tool_input: { command } });
  const stdin = Readable.from([Buffer.from(payload)]);
  vi.spyOn(process, 'stdin', 'get').mockReturnValue(stdin as unknown as typeof process.stdin);

  let written = '';
  const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    written += String(chunk);
    return true;
  });

  await runClaudeCodeHook();
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the Claude Code hook in warn mode', () => {
  it('puts the warning where Claude Code will actually show it', async () => {
    // Claude Code ignores stderr on exit 0. The warning has to be systemMessage on stdout, or the
    // default mode of the whole product is silent.
    stubNpm(4, 2);

    const output = await runHook('npm i sketchy-pkg', process.cwd());

    expect(output?.systemMessage).toContain('sketchy-pkg');
    expect(output?.systemMessage).toContain('looks suspicious');
  });

  it('tells Claude too, so the agent can reconsider the package', async () => {
    stubNpm(4, 2);

    const output = await runHook('npm i sketchy-pkg', process.cwd());
    const specific = output?.hookSpecificOutput as Record<string, unknown>;

    expect(specific.additionalContext).toContain('sketchy-pkg');
  });

  it('does not block the install, since warn is not strict', async () => {
    stubNpm(4, 2);

    const output = await runHook('npm i sketchy-pkg', process.cwd());
    const specific = output?.hookSpecificOutput as Record<string, unknown>;

    expect(specific.permissionDecision).toBeUndefined();
  });

  it('says nothing at all about an established package', async () => {
    stubNpm(50_000_000, 3000);

    expect(await runHook('npm i react', process.cwd())).toBeNull();
  });

  it('says nothing for a command that is not an install', async () => {
    stubNpm(4, 2);

    expect(await runHook('npm run build', process.cwd())).toBeNull();
  });

  it('says nothing for a bare install, which only reads the lockfile', async () => {
    stubNpm(4, 2);

    expect(await runHook('npm install', process.cwd())).toBeNull();
  });

  it('never puts escape codes in the JSON it emits', async () => {
    stubNpm(4, 2);

    const output = await runHook('npm i sketchy-pkg', process.cwd());

    expect(String(output?.systemMessage)).not.toContain('');
  });
});
