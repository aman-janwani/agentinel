import { describe, expect, it } from 'vitest';
import { positionals, readFlag } from '../src/cli/args.js';

describe('positionals', () => {
  it('does not mistake a flag value for a positional', () => {
    expect(positionals(['--reason', 'vetted internally', 'my-pkg'])).toEqual(['my-pkg']);
  });

  it('reads the package name whichever side of the flag it is on', () => {
    expect(positionals(['my-pkg', '--reason', 'vetted'])).toEqual(['my-pkg']);
  });

  it('handles the inline form, where the value is not a separate argument', () => {
    expect(positionals(['--reason=vetted', 'my-pkg'])).toEqual(['my-pkg']);
  });

  it('keeps every positional for a multi package check', () => {
    expect(positionals(['react', 'lodash', '--json'])).toEqual(['react', 'lodash']);
  });
});

describe('readFlag', () => {
  it('reads a separated value', () => {
    expect(readFlag(['--reason', 'because'], '--reason')).toBe('because');
  });

  it('reads an inline value', () => {
    expect(readFlag(['--reason=because'], '--reason')).toBe('because');
  });

  it('is undefined when the flag is absent', () => {
    expect(readFlag(['my-pkg'], '--reason')).toBeUndefined();
  });
});
