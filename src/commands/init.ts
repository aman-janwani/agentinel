import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRootOrCwd } from '../checks/package-guard/staged-deps.js';
import { configPath, saveConfig } from '../config/load.js';
import { defaultConfig } from '../config/schema.js';

const HOOK_MARKER = 'agentsentinel';

export function runInit(): number {
  const repoRoot = repoRootOrCwd();
  const command = hookCommand(repoRoot);

  writeConfig(repoRoot);
  wireClaudeCodeHook(repoRoot, command);
  wirePreCommitHook(repoRoot, command);

  console.log('\nagentsentinel is set up. New npm packages will be checked before they land.');
  console.log(
    'Default mode is warn. Set "mode": "strict" in .agentsentinel.json to block instead.',
  );
  return 0;
}

/**
 * Prefer the copy installed in the repo, so the hook does not pay npx resolution cost on every
 * single Bash call. Fall back to npx for the `npx agentsentinel init` path, where the package was
 * never actually added as a dependency.
 */
function hookCommand(repoRoot: string): string {
  const local = join(repoRoot, 'node_modules', '.bin', 'asen');
  return existsSync(local) ? '"$CLAUDE_PROJECT_DIR"/node_modules/.bin/asen' : 'npx agentsentinel';
}

function writeConfig(repoRoot: string): void {
  const path = configPath(repoRoot);
  if (existsSync(path)) {
    console.log('.agentsentinel.json already exists, left alone');
    return;
  }
  saveConfig(repoRoot, defaultConfig());
  console.log('wrote .agentsentinel.json');
}

function wireClaudeCodeHook(repoRoot: string, command: string): void {
  const dir = join(repoRoot, '.claude');
  const path = join(dir, 'settings.json');

  let settings: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
      if (typeof parsed === 'object' && parsed !== null) {
        settings = parsed as Record<string, unknown>;
      }
    } catch {
      console.log('.claude/settings.json is not valid JSON, skipping the Claude Code hook');
      return;
    }
  }

  const hooks = asRecord(settings.hooks) ?? {};
  const preToolUse = Array.isArray(hooks.PreToolUse) ? (hooks.PreToolUse as unknown[]) : [];

  if (JSON.stringify(preToolUse).includes(HOOK_MARKER)) {
    console.log('Claude Code hook already registered, left alone');
    return;
  }

  preToolUse.push({
    matcher: 'Bash',
    hooks: [{ type: 'command', command: `${command} hook claude-code` }],
  });

  hooks.PreToolUse = preToolUse;
  settings.hooks = hooks;

  mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  console.log('registered the Claude Code PreToolUse hook in .claude/settings.json');
}

function wirePreCommitHook(repoRoot: string, command: string): void {
  const dir = join(repoRoot, '.git', 'hooks');
  if (!existsSync(join(repoRoot, '.git'))) {
    console.log('not a git repo, skipping the pre-commit hook');
    return;
  }

  const path = join(dir, 'pre-commit');
  const script = `#!/bin/sh\n# ${HOOK_MARKER}: check newly added npm packages before they get committed\n${command} hook pre-commit\n`;

  if (existsSync(path)) {
    const existing = readFileSync(path, 'utf8');
    if (existing.includes(HOOK_MARKER)) {
      console.log('pre-commit hook already installed, left alone');
      return;
    }
    // Someone else owns this hook (husky, lint-staged, a hand written one). Overwriting it would
    // silently break their setup, so tell them what to add instead.
    console.log('a pre-commit hook already exists, not overwriting it');
    console.log(`add this line to ${path}:\n  ${command} hook pre-commit`);
    return;
  }

  mkdirSync(dir, { recursive: true });
  writeFileSync(path, script, 'utf8');
  chmodSync(path, 0o755);
  console.log('installed the git pre-commit hook');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}
