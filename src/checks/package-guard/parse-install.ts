// Works out which npm packages a shell command would install. Everything here errs on the side
// of returning nothing: a missed package is a missed warning, but a wrong guess means we warn
// about something the user never asked for, which trains people to ignore the tool.

/**
 * Package managers that install from the npm registry. pnpm and yarn are different clients for
 * the same registry, so the age and download signals mean exactly the same thing for all three.
 */
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn']);

/** Subcommands that install a named package. npm accepts several aliases for `install`. */
const INSTALL_SUBCOMMANDS = new Set([
  'install',
  'i',
  'add',
  'in',
  'ins',
  'inst',
  'insta',
  'instal',
]);

/** Flags whose value is a separate token, so the value must not be read as a package name. */
const VALUE_TAKING_FLAGS = new Set(['--registry', '--prefix', '--workspace', '-w']);

/**
 * npm's naming rules: url-safe, optional scope, no leading dot or underscore, 214 characters max.
 *
 * Case insensitive on purpose. npm refuses *new* names with capitals, but plenty of established
 * ones have them (`JSONStream` alone gets tens of millions of downloads a month) and they install
 * fine. Rejecting them meant a real dependency was quietly skipped and the user was told, wrongly,
 * that it was not a valid package name.
 */
const PACKAGE_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;

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
  const manager = tokens[0];
  if (manager === undefined || !PACKAGE_MANAGERS.has(manager)) {
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
  if (separator === -1) {
    return isValidPackageName(token) ? token : null;
  }

  const specifier = token.slice(separator + 1);

  // An aliased install, `local-name@npm:real-package`, installs the package on the right. Reading
  // the name on the left would check something nobody is installing and miss what actually lands.
  if (specifier.startsWith('npm:')) {
    return packageNameFrom(specifier.slice('npm:'.length));
  }

  const name = token.slice(0, separator);
  return isValidPackageName(name) ? name : null;
}
