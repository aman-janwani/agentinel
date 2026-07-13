import { describe, expect, it } from 'vitest';
import { denyReason, formatVerdict } from '../src/output/format.js';

const ANSI = /\[/;

describe('formatVerdict', () => {
  it('prints nothing for a clean package', () => {
    expect(formatVerdict({ kind: 'clean', name: 'zod' })).toBeNull();
  });

  it('prints nothing for an allowlisted package', () => {
    expect(
      formatVerdict({ kind: 'allowlisted', name: 'my-own-package', reason: 'published by me' }),
    ).toBeNull();
  });

  it('includes the real age and download numbers when flagged', () => {
    const text = formatVerdict({
      kind: 'flagged',
      name: 'fast-json-validator-pro',
      ageDays: 9,
      downloads: 4,
    });

    expect(text).toContain('fast-json-validator-pro');
    expect(text).toContain('9 days');
    expect(text).toContain('4 downloads');
    expect(text).toContain('slopsquatting');
    expect(text).toContain('asen allow fast-json-validator-pro');
  });

  it('reads differently from flagged when the package does not exist', () => {
    const notFound = formatVerdict({ kind: 'not-found', name: 'ghost-pkg' });
    const flagged = formatVerdict({
      kind: 'flagged',
      name: 'ghost-pkg',
      ageDays: 9,
      downloads: 4,
    });

    expect(notFound).toContain('does not exist on the npm registry');
    expect(notFound).not.toContain('looks suspicious');
    expect(notFound).not.toBe(flagged);
  });

  it('says a skipped check did not block anything', () => {
    const text = formatVerdict({ kind: 'skipped', name: 'zod', reason: 'registry timed out' });

    expect(text).toContain('zod');
    expect(text).toContain('registry timed out');
    expect(text).toContain('nothing was blocked');
  });
});

describe('denyReason', () => {
  it('has no ANSI codes', () => {
    const reason = denyReason([
      { kind: 'flagged', name: 'fast-json-validator-pro', ageDays: 9, downloads: 4 },
      { kind: 'not-found', name: 'ghost-pkg' },
    ]);

    expect(ANSI.test(reason)).toBe(false);
  });

  it('summarises the flagged and missing packages with their real numbers', () => {
    const reason = denyReason([
      { kind: 'clean', name: 'zod' },
      { kind: 'flagged', name: 'fast-json-validator-pro', ageDays: 9, downloads: 4 },
      { kind: 'not-found', name: 'ghost-pkg' },
    ]);

    expect(reason).toContain('fast-json-validator-pro');
    expect(reason).toContain('9 days');
    expect(reason).toContain('4 downloads');
    expect(reason).toContain('ghost-pkg');
    expect(reason).toContain('does not exist on the npm registry');
    expect(reason).not.toContain('zod');
  });
});
