import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { repoRootOrCwd } from '../checks/package-guard/staged-deps.js';
import { configPath, saveConfig } from '../config/load.js';
import { defaultConfig } from '../config/schema.js';
import { isWindows } from '../platform.js';
import { installShim, type ShimTarget } from './shim.js';

/** Written into the pre-commit script so we can recognise our own hook file later. */
const HOOK_MARKER = 'agentinel';

/** In the registered command whichever way the package was installed. */
const HOOK_SUBCOMMAND = 'hook claude-code';

export interface InitOptions {
  /** Also put the PATH shims in place, so installs typed by hand are checked too. */
  shim?: boolean;
  /** Where the shim writes. Only set by tests, so they never touch a real home directory. */
  shimTarget?: ShimTarget;
}

export function runInit(options: InitOptions = {}): number {
  const repoRoot = repoRootOrCwd();

  writeConfig(repoRoot);
  wireClaudeCodeHook(repoRoot, claudeCodeCommand(repoRoot));
  wireOtherAgents(repoRoot, agentHookCommand(repoRoot));
  wirePreCommitHook(repoRoot, gitHookCommand(repoRoot));

  if (options.shim) {
    installShim(repoRoot, options.shimTarget);
  }

  console.log('\nagentinel is set up. New npm packages will be checked before they land.');
  console.log(
    'Default mode is strict. Set "mode": "warn" in .agentinel.json to only warn instead.',
  );

  // The Claude Code hook runs on every Bash call, and resolving through npx each time costs about
  // three quarters of a second. Installing it in the repo removes that. It is the difference
  // between a tool people keep and one they rip out because the agent started feeling slow.
  if (!hasLocalInstall(repoRoot)) {
    console.log('\nThe hook runs on every command, and going through npx each time is slow.');
    console.log('For faster hooks, add it to the repo and run init again:');
    console.log('  npm install --save-dev agentinel && npx asen init');
  }

  return 0;
}

function hasLocalInstall(repoRoot: string): boolean {
  return existsSync(join(repoRoot, 'node_modules', '.bin', 'asen'));
}

/**
 * Claude Code runs hooks from an unspecified working directory, so the path has to be absolute.
 * CLAUDE_PROJECT_DIR is the variable it sets for exactly this.
 *
 * On Windows Claude Code runs the hook through cmd.exe by default, where `$CLAUDE_PROJECT_DIR`, the
 * forward slashes, and the extension-less `asen` all fail. The `npx agentinel` form works in cmd,
 * so Windows uses it even when the package is installed locally, giving up a little startup speed
 * for a command that actually runs.
 */
function claudeCodeCommand(repoRoot: string): string {
  if (isWindows()) {
    return 'npx agentinel';
  }
  return hasLocalInstall(repoRoot)
    ? '"$CLAUDE_PROJECT_DIR"/node_modules/.bin/asen'
    : 'npx agentinel';
}

/**
 * Git runs hooks from the root of the working tree, so a relative path is right here. It must not
 * be CLAUDE_PROJECT_DIR, which is unset during a plain `git commit` and would expand to nothing,
 * leaving the hook pointing at /node_modules and failing every commit.
 */
function gitHookCommand(repoRoot: string): string {
  return hasLocalInstall(repoRoot) ? './node_modules/.bin/asen' : 'npx agentinel';
}

function writeConfig(repoRoot: string): void {
  const path = configPath(repoRoot);
  if (existsSync(path)) {
    console.log('.agentinel.json already exists, left alone');
    return;
  }
  saveConfig(repoRoot, defaultConfig());
  console.log('wrote .agentinel.json');
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

  if (alreadyRegistered(preToolUse)) {
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

/**
 * Codex, Copilot and Gemini all run the hook through a shell, and none of them promise the working
 * directory is the repo root, so the path is resolved from the git root rather than assumed. Claude
 * Code has CLAUDE_PROJECT_DIR for this, the others have nothing equivalent.
 */
function agentHookCommand(repoRoot: string): string {
  // Same reasoning as the Claude Code command: the `$(...)` substitution is POSIX only and fails in
  // cmd.exe, so Windows uses the npx form, which resolves through PATHEXT and works.
  if (isWindows()) {
    return 'npx agentinel';
  }
  return hasLocalInstall(repoRoot)
    ? '"$(git rev-parse --show-toplevel)"/node_modules/.bin/asen'
    : 'npx agentinel';
}

/**
 * Wire up whichever of the other agents this machine actually uses.
 *
 * Only agents we can see evidence of, either a config directory in the repo or one in the home
 * directory. Writing a .codex, a .gemini and a .github/hooks into every repo that runs init would
 * be litter, and litter in someone's repo is how a tool gets removed.
 */
function wireOtherAgents(repoRoot: string, command: string): void {
  if (uses(repoRoot, '.codex')) {
    wireCodexHook(repoRoot, command);
  }
  if (uses(repoRoot, '.copilot') || existsSync(join(repoRoot, '.github', 'hooks'))) {
    wireCopilotHook(repoRoot, command);
  }
  if (uses(repoRoot, '.gemini')) {
    wireGeminiHook(repoRoot, command);
  }
}

function uses(repoRoot: string, dir: string): boolean {
  return existsSync(join(repoRoot, dir)) || existsSync(join(homedir(), dir));
}

/**
 * Codex: .codex/hooks.json, the same PascalCase PreToolUse shape Claude Code uses.
 * https://learn.chatgpt.com/docs/hooks
 */
function wireCodexHook(repoRoot: string, command: string): void {
  const path = join(repoRoot, '.codex', 'hooks.json');
  const file = readJson(path);
  if (file === null) {
    console.log('.codex/hooks.json is not valid JSON, skipping the Codex hook');
    return;
  }

  const hooks = asRecord(file.hooks) ?? {};
  const preToolUse = Array.isArray(hooks.PreToolUse) ? (hooks.PreToolUse as unknown[]) : [];

  if (registers(preToolUse, 'codex')) {
    console.log('Codex hook already registered, left alone');
    return;
  }

  preToolUse.push({
    matcher: 'Bash',
    hooks: [{ type: 'command', command: `${command} hook codex` }],
  });
  hooks.PreToolUse = preToolUse;
  file.hooks = hooks;

  writeJson(path, file);
  console.log('registered the Codex PreToolUse hook in .codex/hooks.json');
}

/**
 * Copilot: its own file under .github/hooks, which is auto-discovered. camelCase preToolUse, and
 * the shell command goes in `bash`. https://docs.github.com/en/copilot/reference/hooks-configuration
 */
function wireCopilotHook(repoRoot: string, command: string): void {
  const path = join(repoRoot, '.github', 'hooks', 'agentinel.json');
  const file = readJson(path);
  if (file === null) {
    console.log('.github/hooks/agentinel.json is not valid JSON, skipping the Copilot hook');
    return;
  }

  const hooks = asRecord(file.hooks) ?? {};
  const preToolUse = Array.isArray(hooks.preToolUse) ? (hooks.preToolUse as unknown[]) : [];

  if (registers(preToolUse, 'copilot')) {
    console.log('Copilot hook already registered, left alone');
    return;
  }

  preToolUse.push({ type: 'command', matcher: 'bash', bash: `${command} hook copilot` });
  hooks.preToolUse = preToolUse;
  file.version = 1;
  file.hooks = hooks;

  writeJson(path, file);
  console.log('registered the Copilot preToolUse hook in .github/hooks/agentinel.json');
}

/**
 * Gemini: settings.json, event BeforeTool, and the shell tool is called run_shell_command.
 * https://geminicli.com/docs/hooks/reference/
 */
function wireGeminiHook(repoRoot: string, command: string): void {
  const path = join(repoRoot, '.gemini', 'settings.json');
  const file = readJson(path);
  if (file === null) {
    console.log('.gemini/settings.json is not valid JSON, skipping the Gemini hook');
    return;
  }

  const hooks = asRecord(file.hooks) ?? {};
  const beforeTool = Array.isArray(hooks.BeforeTool) ? (hooks.BeforeTool as unknown[]) : [];

  if (registers(beforeTool, 'gemini')) {
    console.log('Gemini hook already registered, left alone');
    return;
  }

  beforeTool.push({
    matcher: 'run_shell_command',
    hooks: [{ type: 'command', command: `${command} hook gemini` }],
  });
  hooks.BeforeTool = beforeTool;
  file.hooks = hooks;

  writeJson(path, file);
  console.log('registered the Gemini BeforeTool hook in .gemini/settings.json');
}

/** Reads a JSON object, treating a missing file as empty. Null means the file is there and broken. */
function readJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) {
    return {};
  }

  try {
    return asRecord(JSON.parse(readFileSync(path, 'utf8'))) ?? {};
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

/**
 * Whether our hook for this agent is already in the list. Matched on the subcommand, not the
 * package name: when the package is installed in the repo the registered command points straight at
 * node_modules/.bin/asen and the word "agentinel" appears nowhere in it, so matching on the name
 * would miss our own entry and init would bolt on a duplicate every time it ran.
 */
function registers(entries: unknown[], kind: string): boolean {
  return JSON.stringify(entries).includes(`hook ${kind}`);
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

/**
 * Whether our hook is already in the PreToolUse list.
 *
 * This looks for the subcommand, not for the package name. When the package is installed in the
 * repo the registered command is `.../node_modules/.bin/asen hook claude-code`, which does not
 * contain the word "agentinel" anywhere. Searching for the package name therefore missed our own
 * hook and `init` bolted on a duplicate every time it ran, so the hook fired once per copy on
 * every single Bash call. `hook claude-code` is in the command whichever way it was installed.
 */
function alreadyRegistered(preToolUse: unknown[]): boolean {
  return JSON.stringify(preToolUse).includes(`${HOOK_SUBCOMMAND}`);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}
