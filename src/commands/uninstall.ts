import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { repoRootOrCwd } from '../checks/package-guard/staged-deps.js';
import { hooksDirectory } from './init.js';
import { removeShim } from './shim.js';

const HOOK_MARKER = 'agentinel';
const HOOK_SUBCOMMAND = 'hook claude-code';

export function runUninstall(): number {
  const repoRoot = repoRootOrCwd();

  unwireClaudeCodeHook(repoRoot);
  unwireCodexHook(repoRoot);
  unwireCopilotHook(repoRoot);
  unwireGeminiHook(repoRoot);
  unwirePreCommitHook(repoRoot);
  removeShim();

  console.log('agentinel has been completely uninstalled from this repository.');
  return 0;
}

function unwireClaudeCodeHook(repoRoot: string): void {
  const path = join(repoRoot, '.claude', 'settings.json');
  if (!existsSync(path)) return;

  const file = readJson(path);
  if (file === null) return;

  const hooks = asRecord(file.hooks);
  if (!hooks || !Array.isArray(hooks.PreToolUse)) return;

  const preToolUse = hooks.PreToolUse as unknown[];
  hooks.PreToolUse = preToolUse.filter((hook) => !JSON.stringify(hook).includes(HOOK_SUBCOMMAND));
  
  if ((hooks.PreToolUse as unknown[]).length === 0) {
    delete hooks.PreToolUse;
  }
  
  if (Object.keys(hooks).length === 0) {
    delete file.hooks;
  }

  writeJson(path, file);
  console.log('removed Claude Code hook');
}

function unwireCodexHook(repoRoot: string): void {
  const path = join(repoRoot, '.codex', 'hooks.json');
  if (!existsSync(path)) return;

  const file = readJson(path);
  if (file === null) return;

  const hooks = asRecord(file.hooks);
  if (!hooks || !Array.isArray(hooks.PreToolUse)) return;

  const preToolUse = hooks.PreToolUse as unknown[];
  hooks.PreToolUse = preToolUse.filter((hook) => !JSON.stringify(hook).includes('hook codex'));

  writeJson(path, file);
  console.log('removed Codex hook');
}

function unwireCopilotHook(repoRoot: string): void {
  const path = join(repoRoot, '.github', 'hooks', 'agentinel.json');
  if (!existsSync(path)) return;

  const file = readJson(path);
  if (file === null) return;

  const hooks = asRecord(file.hooks);
  if (!hooks || !Array.isArray(hooks.preToolUse)) return;

  const preToolUse = hooks.preToolUse as unknown[];
  hooks.preToolUse = preToolUse.filter((hook) => !JSON.stringify(hook).includes('hook copilot'));

  writeJson(path, file);
  console.log('removed Copilot hook');
}

function unwireGeminiHook(repoRoot: string): void {
  const path = join(repoRoot, '.gemini', 'settings.json');
  if (!existsSync(path)) return;

  const file = readJson(path);
  if (file === null) return;

  const hooks = asRecord(file.hooks);
  if (!hooks || !Array.isArray(hooks.BeforeTool)) return;

  const beforeTool = hooks.BeforeTool as unknown[];
  hooks.BeforeTool = beforeTool.filter((hook) => !JSON.stringify(hook).includes('hook gemini'));

  writeJson(path, file);
  console.log('removed Gemini hook');
}

function unwirePreCommitHook(repoRoot: string): void {
  if (!existsSync(join(repoRoot, '.git'))) return;

  const path = join(hooksDirectory(repoRoot), 'pre-commit');
  if (!existsSync(path)) return;

  const existing = readFileSync(path, 'utf8');
  if (!existing.includes(HOOK_MARKER)) return;

  rmSync(path);
  console.log('removed git pre-commit hook');
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(readFileSync(path, 'utf8'))) ?? {};
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}
