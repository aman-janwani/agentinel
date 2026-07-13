// Works out which npm packages a shell command would install. Everything here errs on the side
// of returning nothing: a missed package is a missed warning, but a wrong guess means we warn
// about something the user never asked for, which trains people to ignore the tool.

/** Subcommands that install a named package. `pnpm add` / `yarn add` are out of scope for v1. */
const INSTALL_SUBCOMMANDS = new Set(['install', 'i', 'add']);

/** Flags whose value is a separate token, so the value must not be read as a package name. */
const VALUE_TAKING_FLAGS = new Set(['--registry', '--prefix', '--workspace', '-w']);

/** npm's own rules: lowercase, url-safe, optional scope, no leading dot or underscore. */
const PACKAGE_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

export function isValidPackageName(token: string): boolean {
  if (token.length === 0 || token.length > 214) {
    return false;
  }
  return PACKAGE_NAME.test(token);
}

/**
 * Returns the npm package names the command would install, or [] if it is not an npm install or
 * cannot be confidently parsed. A bare `npm install` installs from the lockfile, so it has no
 * candidates.
 */
export function parseInstallCommand(command: string): string[] {
  const names: string[] = [];

  for (const segment of splitSegments(command)) {
    for (const name of parseSegment(segment)) {
      if (!names.includes(name)) {
        names.push(name);
      }
    }
  }

  return names;
}

/** Splits on shell separators so `cd foo && npm i x` is checked segment by segment. */
function splitSegments(command: string): string[] {
  return command
    .split(/&&|\|\||[;|&\n]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function parseSegment(segment: string): string[] {
  const tokens = tokenize(segment);
  if (tokens[0] !== 'npm') {
    return [];
  }

  // Flags can appear before the subcommand too, for example `npm --silent i left-pad`.
  let index = 1;
  while (index < tokens.length && isFlag(tokens[index]!)) {
    index += consumedBy(tokens[index]!);
  }

  const subcommand = tokens[index];
  if (subcommand === undefined || !INSTALL_SUBCOMMANDS.has(subcommand)) {
    return [];
  }
  index += 1;

  const names: string[] = [];
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (isFlag(token)) {
      index += consumedBy(token);
      continue;
    }

    const name = packageNameFrom(token);
    if (name !== null) {
      names.push(name);
    }
    index += 1;
  }

  return names;
}

/** Splits on whitespace, keeping quoted runs together and dropping the quotes. */
function tokenize(segment: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;

  let match = pattern.exec(segment);
  while (match !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? '');
    match = pattern.exec(segment);
  }

  return tokens;
}

function isFlag(token: string): boolean {
  return token.startsWith('-') && token.length > 1;
}

/** How many tokens this flag accounts for: 2 if its value is a separate token, otherwise 1. */
function consumedBy(flag: string): number {
  if (flag.includes('=')) {
    return 1;
  }
  return VALUE_TAKING_FLAGS.has(flag) ? 2 : 1;
}

/**
 * Strips a version specifier and returns the package name, or null if the token is anything
 * other than a plain registry package (a tarball URL, a git URL, a local path, a typo).
 */
function packageNameFrom(token: string): string | null {
  const separator = token.startsWith('@') ? token.indexOf('@', 1) : token.indexOf('@');
  const name = separator === -1 ? token : token.slice(0, separator);

  return isValidPackageName(name) ? name : null;
}
