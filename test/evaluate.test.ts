import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { evaluate } from '../src/checks/package-guard/evaluate.js';
import { setKnownMalwareForTests } from '../src/checks/package-guard/malware.js';
import { defaultConfig } from '../src/config/schema.js';
import type { Config, DownloadsResult, PackageFacts, RegistryResult } from '../src/types.js';

const NOW = new Date('2026-07-14T00:00:00.000Z');

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 86400000);
}

/** A perfectly ordinary, healthy package. Tests override only the field they care about. */
function facts(overrides: Partial<PackageFacts> = {}): PackageFacts {
  return {
    created: daysAgo(2000),
    latestVersion: '1.2.3',
    securityHold: false,
    versionCount: 40,
    hasRepository: true,
    latestPublisher: 'sindresorhus',
    priorPublishers: ['sindresorhus', 'sindresorhus', 'sindresorhus', 'sindresorhus'],
    unpackedSize: 50_000,
    previousUnpackedSize: 49_000,
    latestIsSmallBump: true,
    ...overrides,
  };
}

function found(overrides: Partial<PackageFacts> = {}): RegistryResult {
  return { kind: 'found', facts: facts(overrides) };
}

function downloads(lastMonth: number): DownloadsResult {
  return { kind: 'found', lastMonth };
}

const kinds = (
  name: string,
  r: RegistryResult,
  d: DownloadsResult,
  c: Config = defaultConfig(),
) => {
  const verdict = evaluate(name, r, d, c, NOW);
  return verdict.kind === 'flagged' ? verdict.reasons.map((x) => x.kind) : [verdict.kind];
};

beforeEach(() => setKnownMalwareForTests({}));
afterEach(() => setKnownMalwareForTests(null));

describe('a healthy package', () => {
  it('is clean', () => {
    expect(kinds('lodash', found(), downloads(50_000_000))).toEqual(['clean']);
  });

  it('stays clean even when obscure, as long as it has a history', () => {
    expect(kinds('quiet-old-tool', found(), downloads(4))).toEqual(['clean']);
  });
});

describe('signals that never expire', () => {
  it('flags a package on the public malware list', () => {
    setKnownMalwareForTests({ 'evil-pkg': [] });

    expect(kinds('evil-pkg', found(), downloads(50_000_000))).toEqual(['known-malware']);
  });

  it('flags known malware even when the registry is unreachable', () => {
    setKnownMalwareForTests({ 'evil-pkg': [] });
    const offline: RegistryResult = { kind: 'unavailable', reason: 'offline' };

    expect(kinds('evil-pkg', offline, downloads(0))).toEqual(['known-malware']);
  });

  it('flags a package npm has taken down, however old and popular it is', () => {
    // This is what catches unused-imports and crossenv today, years after the fact, where the age
    // rule gave up long ago.
    expect(kinds('crossenv', found({ securityHold: true }), downloads(50_000))).toEqual([
      'security-hold',
    ]);
  });

  it('does NOT flag on a publisher change alone, which happens constantly', () => {
    // The fingerprint of a stolen maintainer token, and the one thing a malware list can never
    // catch, because nobody has found it yet.
    const drifted = found({
      latestPublisher: 'some-new-person',
      priorPublishers: ['GitHub Actions', 'GitHub Actions', 'GitHub Actions', 'GitHub Actions'],
    });

    // Drift alone must NOT flag. Measured against the 100 most depended-on packages, flagging it
    // alone false-positived on eight of them: redux (acemarke handing over to phryneas), mocha (a
    // maintainer publishing by hand rather than through CI), tsup (which moved *to* CI, an
    // improvement). Maintainer teams rotate publishers constantly.
    expect(kinds('popular-lib', drifted, downloads(9_000_000))).toEqual(['clean']);
  });

  it('does not flag a package that has always been published by the same person', () => {
    expect(kinds('chalk', found(), downloads(9_000_000))).toEqual(['clean']);
  });

  it('does not flag a package that has always been published by CI', () => {
    const ci = found({
      latestPublisher: 'GitHub Actions',
      priorPublishers: ['GitHub Actions', 'GitHub Actions', 'GitHub Actions', 'GitHub Actions'],
    });

    expect(kinds('zod', ci, downloads(9_000_000))).toEqual(['clean']);
  });

  it('flags a package with no repository, one version, and nobody using it', () => {
    // react-codeshift is 180 days old, so the age rule misses it entirely. This is what catches it.
    const nothing = found({ created: daysAgo(180), hasRepository: false, versionCount: 1 });

    expect(kinds('react-codeshift', nothing, downloads(24))).toEqual(['no-track-record']);
  });

  it('flags a patch bump that suddenly ships three times the code', () => {
    const bloated = found({ unpackedSize: 300_000, previousUnpackedSize: 50_000 });

    expect(kinds('popular-lib', bloated, downloads(9_000_000))).toEqual(['size-jump']);
  });

  it('does not flag a size jump across a major version, where it is normal', () => {
    const rewrite = found({
      unpackedSize: 300_000,
      previousUnpackedSize: 50_000,
      latestIsSmallBump: false,
    });

    expect(kinds('popular-lib', rewrite, downloads(9_000_000))).toEqual(['clean']);
  });
});

describe('the age and downloads signal', () => {
  it('flags a new, unused package', () => {
    expect(kinds('sketchy', found({ created: daysAgo(2) }), downloads(4))).toEqual([
      'new-and-unpopular',
    ]);
  });

  it('does not flag a new but popular package', () => {
    expect(kinds('hot-new-thing', found({ created: daysAgo(2) }), downloads(80_000))).toEqual([
      'clean',
    ]);
  });

  it('treats no download record as zero downloads', () => {
    const verdict = evaluate(
      'brand-new',
      found({ created: daysAgo(0) }),
      { kind: 'no-data' },
      defaultConfig(),
      NOW,
    );

    expect(verdict.kind).toBe('flagged');
  });
});

describe('several signals at once', () => {
  it('reports every reason, not just the first', () => {
    const awful = found({
      created: daysAgo(1),
      hasRepository: false,
      versionCount: 1,
      securityHold: true,
    });

    expect(kinds('nightmare', awful, downloads(0)).sort()).toEqual(
      ['new-and-unpopular', 'no-track-record', 'security-hold'].sort(),
    );
  });
});

describe('the boring cases', () => {
  it('reports a package the registry has never heard of', () => {
    expect(kinds('made-up', { kind: 'not-found' }, downloads(0))).toEqual(['not-found']);
  });

  it('skips when the registry is unreachable', () => {
    const offline: RegistryResult = { kind: 'unavailable', reason: 'registry timed out' };

    expect(kinds('lodash', offline, downloads(10))).toEqual(['skipped']);
  });

  it('allowlists a package that would otherwise be flagged', () => {
    const config: Config = {
      mode: 'warn',
      allow: [{ name: 'internal', reason: 'ours', date: '2026-01-01' }],
    };

    expect(kinds('internal', found({ created: daysAgo(1) }), downloads(0), config)).toEqual([
      'allowlisted',
    ]);
  });
});

describe('publisher drift as a corroborating signal', () => {
  it('is reported when something else already looks wrong', () => {
    // A new publisher shipping a normal release is a handover. A new publisher whose release also
    // triples the size of the package is what an injected payload looks like.
    const compromised = found({
      latestPublisher: 'some-new-person',
      priorPublishers: ['GitHub Actions', 'GitHub Actions', 'GitHub Actions', 'GitHub Actions'],
      unpackedSize: 300_000,
      previousUnpackedSize: 50_000,
    });

    expect(kinds('popular-lib', compromised, downloads(9_000_000)).sort()).toEqual(
      ['publisher-drift', 'size-jump'].sort(),
    );
  });
});
