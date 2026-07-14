import { describe, expect, it } from 'vitest';
import { denyReason, formatVerdict, plainVerdict } from '../src/output/format.js';
import type { Reason, Verdict } from '../src/types.js';

const flagged = (name: string, reasons: Reason[]): Verdict => ({ kind: 'flagged', name, reasons });

describe('formatVerdict', () => {
  it('says nothing at all about a clean package', () => {
    expect(formatVerdict({ kind: 'clean', name: 'zod' })).toBeNull();
    expect(formatVerdict({ kind: 'allowlisted', name: 'zod', reason: 'ours' })).toBeNull();
  });

  it('lists every reason a package was flagged', () => {
    const text =
      plainVerdict(
        flagged('sketchy', [
          { kind: 'new-and-unpopular', ageDays: 2, downloads: 4 },
          { kind: 'no-track-record', downloads: 4 },
        ]),
      ) ?? '';

    expect(text).toContain('SUSPICIOUS PACKAGE');
    expect(text).toContain('sketchy');
    expect(text).toContain('2 days');
    expect(text).toContain('no repository');
  });

  it('says MALICIOUS, not suspicious, when the package is confirmed malware', () => {
    // Known malware is a fact. Age and downloads are a guess. Saying both in the same tone would
    // waste the strongest signal we have.
    const text = plainVerdict(flagged('evil', [{ kind: 'known-malware' }])) ?? '';

    expect(text).toContain('MALICIOUS PACKAGE');
    expect(text).not.toContain('SUSPICIOUS');
    expect(text).toContain('Do not install this');
  });

  it('says npm took the package down, in plain words', () => {
    const text = plainVerdict(flagged('crossenv', [{ kind: 'security-hold' }])) ?? '';

    expect(text).toContain('MALICIOUS PACKAGE');
    expect(text).toContain('npm has taken this package down');
  });

  it('explains publisher drift in a way a human can act on', () => {
    const text =
      plainVerdict(
        flagged('popular-lib', [
          { kind: 'publisher-drift', before: 'GitHub Actions', now: 'some-person' },
        ]),
      ) ?? '';

    expect(text).toContain('some-person');
    expect(text).toContain('GitHub Actions');
  });

  it('reads differently when the package does not exist', () => {
    const text = plainVerdict({ kind: 'not-found', name: 'made-up' }) ?? '';

    expect(text).toContain('PACKAGE DOES NOT EXIST');
    expect(text).not.toContain('SUSPICIOUS PACKAGE');
  });

  it('says a skipped check blocked nothing', () => {
    const text =
      formatVerdict({ kind: 'skipped', name: 'zod', reason: 'registry timed out' }) ?? '';

    expect(text).toContain('registry timed out');
    expect(text).toContain('Nothing was blocked.');
  });

  it('never lets a long package name break the border', () => {
    const name = '@a-very-long-scope/an-extremely-long-package-name-that-keeps-going';
    const text = plainVerdict(flagged(name, [{ kind: 'known-malware' }])) ?? '';

    const widths = new Set(
      text
        .split('\n')
        .filter((l) => l.startsWith('│'))
        .map((l) => l.length),
    );
    expect(widths.size).toBe(1);
  });
});

describe('denyReason', () => {
  it('has no ANSI codes, since it goes into JSON', () => {
    const reason = denyReason([flagged('evil', [{ kind: 'known-malware' }])]);

    expect(reason).not.toContain('\u001b');
    expect(reason).toContain('evil');
    expect(reason).toContain('malware');
  });

  it('tells the agent every reason, so it can pick a different package', () => {
    const reason = denyReason([
      flagged('sketchy', [{ kind: 'new-and-unpopular', ageDays: 0, downloads: 0 }]),
    ]);

    expect(reason).toContain('sketchy');
    expect(reason).toContain('0 days');
    expect(reason).toContain('alternative');
  });
});
