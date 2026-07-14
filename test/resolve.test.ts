import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAddLines, resolveInstall } from '../src/checks/package-guard/resolve.js';

describe('parseAddLines', () => {
  it('reads the name and version from each add line', () => {
    const output = ['add media-typer 1.1.0', 'add express 5.1.0', 'removed foo 1.0.0'].join('\n');

    expect(parseAddLines(output)).toEqual([
      { name: 'media-typer', version: '1.1.0' },
      { name: 'express', version: '5.1.0' },
    ]);
  });

  it('keeps the last entry when npm mentions a package twice', () => {
    const output = ['add debug 4.3.0', 'add debug 4.4.3'].join('\n');

    expect(parseAddLines(output)).toEqual([{ name: 'debug', version: '4.4.3' }]);
  });

  it('handles scoped names', () => {
    expect(parseAddLines('add @scope/pkg 2.0.0')).toEqual([
      { name: '@scope/pkg', version: '2.0.0' },
    ]);
  });

  it('returns nothing for output with no add lines', () => {
    expect(parseAddLines('up to date\naudited 1 package')).toEqual([]);
    expect(parseAddLines('')).toEqual([]);
  });
});

describe('resolveInstall against real npm', () => {
  it('resolves the full transitive tree, with versions, installing nothing', () => {
    // The load-bearing feature: `npm install express` names one package and brings in dozens.
    const dir = mkdtempSync(join(tmpdir(), 'resolve-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '1.0.0' }));

    const tree = resolveInstall(dir, ['express']);

    // express pulls in well over a dozen transitive dependencies.
    expect(tree.length).toBeGreaterThan(15);
    expect(tree.every((p) => p.name && p.version)).toBe(true);
    expect(tree.some((p) => p.name === 'express')).toBe(true);
    // debug is a transitive dependency of express, not a direct one.
    expect(tree.some((p) => p.name === 'debug')).toBe(true);
  }, 60000);

  it('returns nothing when asked for nothing', () => {
    expect(resolveInstall(process.cwd(), [])).toEqual([]);
  });
});
