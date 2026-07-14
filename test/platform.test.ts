import { describe, expect, it } from 'vitest';
import { isWindows, npmCommand } from '../src/platform.js';

/** Runs a function with process.platform forced to a value, then restores it. */
function onPlatform<T>(platform: NodeJS.Platform, fn: () => T): T {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, 'platform', original);
  }
}

describe('isWindows', () => {
  it('is true only on win32', () => {
    expect(onPlatform('win32', isWindows)).toBe(true);
    expect(onPlatform('darwin', isWindows)).toBe(false);
    expect(onPlatform('linux', isWindows)).toBe(false);
  });
});

describe('npmCommand', () => {
  it('uses npm.cmd through a shell on Windows, since npm is a batch file there', () => {
    // This is the fix for the "spawn npm ENOENT" failure that silently lost the whole transitive
    // dependency tree on Windows.
    expect(onPlatform('win32', npmCommand)).toEqual({ file: 'npm.cmd', shell: true });
  });

  it('uses a plain npm with no shell on macOS and Linux', () => {
    expect(onPlatform('darwin', npmCommand)).toEqual({ file: 'npm', shell: false });
    expect(onPlatform('linux', npmCommand)).toEqual({ file: 'npm', shell: false });
  });
});
