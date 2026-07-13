import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { repoRootOrCwd } from '../checks/package-guard/staged-deps.js';
import { configPath, saveConfig } from '../config/load.js';
import { defaultConfig } from '../config/schema.js';

const HOOK_MARKER = 'agentsentinel';

export function runInit(): number {
  const repoRoot = repoRootOrCwd();

  writeConfig(repoRoot);
  wireClaudeCodeHook(repoRoot, claudeCodeCommand(repoRoot));
  wirePreCommitHook(repoRoot, gitHookCommand(repoRoot));

  console.log('\nagentsentinel is set up. New npm packages will be checked before they land.');
  console.log(
    'Default mode is warn. Set "mode": "strict" in .agentsentinel.json to block instead.',
  );
  return 0;
}

function hasLocalInstall(repoRoot: string): boolean {
  return existsSync(join(repoRoot, 'node_modules', '.bin', 'asen'));
}

/**
 * Claude Code runs hooks from an unspecified working directory, so the path has to be absolute.
 * CLAUDE_PROJECT_DIR is the variable it sets for exactly this.
 */
function claudeCodeCommand(repoRoot: string): string {
  return hasLocalInstall(repoRoot)
    ? '"$CLAUDE_PROJECT_DIR"/node_modules/.bin/asen'
    : 'npx agentsentinel';
}

/**
 * Git runs hooks from the root of the working tree, so a relative path is right here. It must not
 * be CLAUDE_PROJECT_DIR, which is unset during a plain `git commit` and would expand to nothing,
 * leaving the hook pointing at /node_modules and failing every commit.
 */
function gitHookCommand(repoRoot: string): string {
  return hasLocalInstall(repoRoot) ? './node_modules/.bin/asen' : 'npx agentsentinel';
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

function git(repoRoot: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Where git will actually look for hooks. Two things make this more than `.git/hooks`:
 *
 * - core.hooksPath, which husky sets. Once it is set git ignores .git/hooks entirely, so writing
 *   there would report success and never run, which is worse than not installing at all.
 * - Worktrees and submodules, where .git is a *file* pointing elsewhere, not a directory. Assuming
 *   otherwise means mkdir fails with ENOTDIR and no hook gets installed.
 *
 * Asking git rather than guessing handles both.
 */
export function hooksDirectory(repoRoot: string): string {
  const configured = git(repoRoot, ['config', '--get', 'core.hooksPath']);
  if (configured) {
    return isAbsolute(configured) ? configured : join(repoRoot, configured);
  }

  // Resolves to the real hooks directory even when .git is a file, as in a worktree.
  const path = git(repoRoot, ['rev-parse', '--git-path', 'hooks']);
  if (path) {
    return isAbsolute(path) ? path : join(repoRoot, path);
  }

  return join(repoRoot, '.git', 'hooks');
}

function wirePreCommitHook(repoRoot: string, command: string): void {
  if (!existsSync(join(repoRoot, '.git'))) {
    console.log('not a git repo, skipping the pre-commit hook');
    return;
  }

  const dir = hooksDirectory(repoRoot);
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
  console.log(`installed the git pre-commit hook in ${dir}`);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}
