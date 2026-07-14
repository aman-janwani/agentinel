// The one place operating system differences live. Every other module asks this one rather than
// checking process.platform itself, so there is a single list of what is different on Windows.

export function isWindows(): boolean {
  return process.platform === 'win32';
}

/**
 * How to launch npm as a child process.
 *
 * On Windows npm is `npm.cmd`, a batch file, and Node cannot launch a .cmd file with execFile or
 * spawn unless a shell is involved (documented in the child_process reference, and the cause of the
 * classic "spawn npm ENOENT" on Windows). On Unix npm is a plain executable and needs no shell. So
 * the transitive resolution in resolve.ts, which shells out to npm, has to ask for the right form.
 */
export function npmCommand(): { file: string; shell: boolean } {
  return isWindows() ? { file: 'npm.cmd', shell: true } : { file: 'npm', shell: false };
}
