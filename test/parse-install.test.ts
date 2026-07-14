import { describe, expect, it } from 'vitest';
import {
  isValidPackageName,
  parseInstallCommand,
} from '../src/checks/package-guard/parse-install.js';

describe('parseInstallCommand', () => {
  it('handles the install subcommand and its aliases', () => {
    expect(parseInstallCommand('npm install left-pad')).toEqual(['left-pad']);
    expect(parseInstallCommand('npm i left-pad')).toEqual(['left-pad']);
    expect(parseInstallCommand('npm add left-pad')).toEqual(['left-pad']);
  });

  it('reads pnpm and yarn installs, which resolve from the same registry', () => {
    expect(parseInstallCommand('pnpm add left-pad')).toEqual(['left-pad']);
    expect(parseInstallCommand('yarn add left-pad')).toEqual(['left-pad']);
    expect(parseInstallCommand('pnpm install left-pad')).toEqual(['left-pad']);
  });

  it('ignores commands that do not reach the registry', () => {
    expect(parseInstallCommand('pnpm run build')).toEqual([]);
    expect(parseInstallCommand('npm run test')).toEqual([]);
    expect(parseInstallCommand('git status')).toEqual([]);
  });

  it('does NOT ignore npx, which downloads and runs a package', () => {
    // This used to return [], which was the single worst hole in the tool: `npx evil-pkg` executes
    // code immediately, writes nothing to package.json, and so the pre-commit hook never sees it
    // either. There was no second line of defence at all.
    expect(parseInstallCommand('npx left-pad')).toEqual(['left-pad']);
  });

  it('resolves an aliased install to the package that actually gets installed', () => {
    expect(parseInstallCommand('npm i myalias@npm:evil-package')).toEqual(['evil-package']);
    expect(parseInstallCommand('npm i x@npm:@scope/pkg@1.2.3')).toEqual(['@scope/pkg']);
  });

  it('ignores npm subcommands that do not install a named package', () => {
    expect(parseInstallCommand('npm run build')).toEqual([]);
    expect(parseInstallCommand('npm uninstall left-pad')).toEqual([]);
    expect(parseInstallCommand('npm publish')).toEqual([]);
  });

  it('collects multiple packages from one command', () => {
    expect(parseInstallCommand('npm i a b c')).toEqual(['a', 'b', 'c']);
  });

  it('handles scoped packages', () => {
    expect(parseInstallCommand('npm i @scope/pkg')).toEqual(['@scope/pkg']);
  });

  it('strips version specifiers', () => {
    expect(parseInstallCommand('npm i pkg@1.2.3')).toEqual(['pkg']);
    expect(parseInstallCommand('npm i pkg@latest')).toEqual(['pkg']);
    expect(parseInstallCommand('npm i @scope/pkg@^2.0.0')).toEqual(['@scope/pkg']);
    expect(parseInstallCommand('npm i "pkg@>=1 <2"')).toEqual(['pkg']);
  });

  it('ignores flags wherever they appear', () => {
    expect(parseInstallCommand('npm i --save-dev vitest')).toEqual(['vitest']);
    expect(parseInstallCommand('npm i -D vitest')).toEqual(['vitest']);
    expect(parseInstallCommand('npm install vitest --save')).toEqual(['vitest']);
    expect(parseInstallCommand('npm install -S vitest')).toEqual(['vitest']);
    expect(parseInstallCommand('npm i -g tsx')).toEqual(['tsx']);
    expect(parseInstallCommand('npm i --global tsx')).toEqual(['tsx']);
    expect(parseInstallCommand('npm i zod --legacy-peer-deps')).toEqual(['zod']);
    expect(parseInstallCommand('npm i --some-future-flag zod')).toEqual(['zod']);
    expect(parseInstallCommand('npm --silent i zod')).toEqual(['zod']);
  });

  it("does not mistake a value-taking flag's value for a package", () => {
    expect(parseInstallCommand('npm i --registry https://r.example.com zod')).toEqual(['zod']);
    expect(parseInstallCommand('npm i --registry=https://r.example.com zod')).toEqual(['zod']);
    expect(parseInstallCommand('npm i --prefix ./somewhere zod')).toEqual(['zod']);
    expect(parseInstallCommand('npm i --workspace api zod')).toEqual(['zod']);
    expect(parseInstallCommand('npm i -w api zod')).toEqual(['zod']);
    expect(parseInstallCommand('npm i --registry evil-package')).toEqual([]);
  });

  it('treats a bare install as installing from the lockfile', () => {
    expect(parseInstallCommand('npm install')).toEqual([]);
    expect(parseInstallCommand('npm i')).toEqual([]);
    expect(parseInstallCommand('npm ci')).toEqual([]);
    expect(parseInstallCommand('npm install --production')).toEqual([]);
  });

  it('parses each segment of a chained command', () => {
    expect(parseInstallCommand('npm i x && npm run build')).toEqual(['x']);
    expect(parseInstallCommand('cd foo && npm i x')).toEqual(['x']);
    expect(parseInstallCommand('npm i x; npm i y')).toEqual(['x', 'y']);
    expect(parseInstallCommand('echo hi | npm i x')).toEqual(['x']);
    expect(parseInstallCommand('npm i x || npm i y')).toEqual(['x', 'y']);
    expect(parseInstallCommand('npm i x && npm i x')).toEqual(['x']);
  });

  it('ignores specifiers that are not plain registry packages', () => {
    expect(parseInstallCommand('npm i https://example.com/pkg.tgz')).toEqual([]);
    expect(parseInstallCommand('npm i git+https://github.com/user/repo.git')).toEqual([]);
    expect(parseInstallCommand('npm i git+ssh://git@github.com/user/repo.git')).toEqual([]);
    expect(parseInstallCommand('npm i ./foo')).toEqual([]);
    expect(parseInstallCommand('npm i ../foo')).toEqual([]);
    expect(parseInstallCommand('npm i /abs/path')).toEqual([]);
    expect(parseInstallCommand('npm i file:../foo')).toEqual([]);
    expect(parseInstallCommand('npm i .hidden')).toEqual([]);
  });

  it('picks the valid packages out of a mixed command', () => {
    expect(parseInstallCommand('npm i zod ./local-thing @scope/pkg@1.0.0 -D')).toEqual([
      'zod',
      '@scope/pkg',
    ]);
  });
});

describe('isValidPackageName', () => {
  it('accepts normal names', () => {
    expect(isValidPackageName('zod')).toBe(true);
    expect(isValidPackageName('left-pad')).toBe(true);
    expect(isValidPackageName('lodash.merge')).toBe(true);
    expect(isValidPackageName('@scope/pkg')).toBe(true);
    expect(isValidPackageName('a')).toBe(true);
  });

  it('accepts established names with capitals, which npm still installs', () => {
    // npm refuses *new* names with capitals, but JSONStream and friends predate that rule, get
    // tens of millions of downloads a month, and install fine. Rejecting them meant a real
    // dependency was skipped and the user was told it was not a valid package name.
    expect(isValidPackageName('JSONStream')).toBe(true);
    expect(parseInstallCommand('npm i JSONStream')).toEqual(['JSONStream']);
  });

  it('rejects names npm itself would reject', () => {
    expect(isValidPackageName('')).toBe(false);
    expect(isValidPackageName('.leading-dot')).toBe(false);
    expect(isValidPackageName('_leading-underscore')).toBe(false);
    expect(isValidPackageName('has space')).toBe(false);
    expect(isValidPackageName('has/slash')).toBe(false);
    expect(isValidPackageName('@scope/')).toBe(false);
    expect(isValidPackageName('./local')).toBe(false);
    expect(isValidPackageName('git+https://github.com/a/b.git')).toBe(false);
    expect(isValidPackageName('a'.repeat(215))).toBe(false);
    expect(isValidPackageName('a'.repeat(214))).toBe(true);
  });
});
