import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newStagedDependencies } from '../src/checks/package-guard/staged-deps.js';
import { hooksDirectory, runInit } from '../src/commands/init.js';

let repo: string;
let cwd: string;

function git(...args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
}

function writeJson(relativePath: string, value: unknown): void {
  const full = join(repo, relativePath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, JSON.stringify(value), 'utf8');
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'asen-'));
  cwd = process.cwd();
  process.chdir(repo);

  git('init');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  writeJson('package.json', { name: 'root', version: '1.0.0' });
  git('add', '-A');
  git('commit', '-m', 'init');

  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  process.chdir(cwd);
  rmSync(repo, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('runInit', () => {
  it('writes a pre-commit hook that works outside Claude Code', () => {
    // A local install used to make init emit "$CLAUDE_PROJECT_DIR", which is unset during a plain
    // git commit, so the hook expanded to /node_modules and failed every commit.
    mkdirSync(join(repo, 'node_modules', '.bin'), { recursive: true });
    writeFileSync(join(repo, 'node_modules', '.bin', 'asen'), '', 'utf8');

    runInit();

    const hook = readFileSync(join(repo, '.git', 'hooks', 'pre-commit'), 'utf8');
    expect(hook).not.toContain('CLAUDE_PROJECT_DIR');
    expect(hook).toContain('./node_modules/.bin/asen hook pre-commit');
  });

  it('gives the Claude Code hook an absolute path, since it runs from anywhere', () => {
    mkdirSync(join(repo, 'node_modules', '.bin'), { recursive: true });
    writeFileSync(join(repo, 'node_modules', '.bin', 'asen'), '', 'utf8');

    runInit();

    const settings = readFileSync(join(repo, '.claude', 'settings.json'), 'utf8');
    expect(settings).toContain('CLAUDE_PROJECT_DIR');
  });

  it('falls back to npx when the package is not installed in the repo', () => {
    runInit();

    const hook = readFileSync(join(repo, '.git', 'hooks', 'pre-commit'), 'utf8');
    expect(hook).toContain('npx agentsentinel hook pre-commit');
  });

  it('installs into core.hooksPath, which is where husky makes git look', () => {
    git('config', 'core.hooksPath', '.husky');

    runInit();

    expect(hooksDirectory(repo)).toBe(join(repo, '.husky'));
    const hook = readFileSync(join(repo, '.husky', 'pre-commit'), 'utf8');
    expect(hook).toContain('hook pre-commit');
  });

  it('installs a hook in a git worktree, where .git is a file and not a directory', () => {
    const tree = mkdtempSync(join(tmpdir(), 'asen-wt-'));
    rmSync(tree, { recursive: true, force: true });
    git('worktree', 'add', '-q', tree, '-b', 'feature');
    process.chdir(tree);

    try {
      // This used to throw ENOTDIR, because mkdir cannot create .git/hooks when .git is a file.
      expect(runInit()).toBe(0);

      const hooks = hooksDirectory(tree);
      expect(readFileSync(join(hooks, 'pre-commit'), 'utf8')).toContain('hook pre-commit');
    } finally {
      process.chdir(repo);
      rmSync(tree, { recursive: true, force: true });
    }
  });

  it('does not overwrite a pre-commit hook somebody else owns', () => {
    const existing = '#!/bin/sh\nnpm run lint\n';
    mkdirSync(join(repo, '.git', 'hooks'), { recursive: true });
    writeFileSync(join(repo, '.git', 'hooks', 'pre-commit'), existing, 'utf8');

    runInit();

    expect(readFileSync(join(repo, '.git', 'hooks', 'pre-commit'), 'utf8')).toBe(existing);
  });

  it('merges into an existing .claude/settings.json instead of clobbering it', () => {
    mkdirSync(join(repo, '.claude'), { recursive: true });
    writeJson('.claude/settings.json', { permissions: { allow: ['Bash(ls:*)'] } });

    runInit();

    const settings = JSON.parse(readFileSync(join(repo, '.claude', 'settings.json'), 'utf8'));
    expect(settings.permissions.allow).toEqual(['Bash(ls:*)']);
    expect(settings.hooks.PreToolUse).toHaveLength(1);
  });

  it('is safe to run twice', () => {
    runInit();
    runInit();

    const settings = JSON.parse(readFileSync(join(repo, '.claude', 'settings.json'), 'utf8'));
    expect(settings.hooks.PreToolUse).toHaveLength(1);
  });
});

describe('newStagedDependencies', () => {
  it('finds a dependency added to the root package.json', () => {
    writeJson('package.json', { name: 'root', dependencies: { 'left-pad': '^1.0.0' } });
    git('add', '-A');

    expect(newStagedDependencies(repo)).toEqual(['left-pad']);
  });

  it('finds a dependency added to a workspace package, not just the root', () => {
    writeJson('packages/api/package.json', { name: 'api', dependencies: { 'evil-pkg': '^1.0.0' } });
    git('add', '-A');

    expect(newStagedDependencies(repo)).toEqual(['evil-pkg']);
  });

  it('ignores a version bump on a dependency that was already there', () => {
    writeJson('package.json', { name: 'root', dependencies: { 'left-pad': '^1.0.0' } });
    git('add', '-A');
    git('commit', '-m', 'add left-pad');

    writeJson('package.json', { name: 'root', dependencies: { 'left-pad': '^2.0.0' } });
    git('add', '-A');

    expect(newStagedDependencies(repo)).toEqual([]);
  });

  it('reads devDependencies too', () => {
    writeJson('package.json', { name: 'root', devDependencies: { vitest: '^2.0.0' } });
    git('add', '-A');

    expect(newStagedDependencies(repo)).toEqual(['vitest']);
  });

  it('finds a dependency under a path git would escape and quote', () => {
    // git prints non-ASCII paths as "packages/caf\303\251/package.json" unless asked not to, and
    // every later git command on that mangled path fails, so the dependency went unchecked.
    writeJson('packages/café/package.json', {
      name: 'cafe',
      dependencies: { 'evil-pkg': '^1.0.0' },
    });
    git('add', '-A');

    expect(newStagedDependencies(repo)).toEqual(['evil-pkg']);
  });

  it('ignores a package.json inside node_modules', () => {
    // Some repos commit node_modules. Those manifests belong to installed dependencies, and
    // scanning them would warn about transitive packages nobody chose to add.
    writeJson('node_modules/some-dep/package.json', {
      name: 'some-dep',
      dependencies: { 'transitive-thing': '^1.0.0' },
    });
    git('add', '-Af');

    expect(newStagedDependencies(repo)).toEqual([]);
  });

  it('finds nothing when package.json was not touched', () => {
    writeFileSync(join(repo, 'index.js'), 'console.log(1)', 'utf8');
    git('add', '-A');

    expect(newStagedDependencies(repo)).toEqual([]);
  });
});
