// Works out what a shell command would pull from the npm registry. Everything here errs on the
// side of returning nothing: a missed package is a missed warning, but a wrong guess means we warn
// about something the user never asked for, which trains people to ignore the tool.

/**
 * Clients that install from the npm registry. They are different front ends to the same registry,
 * so the age, download and malware signals mean exactly the same thing for all of them.
 */
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);

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

/**
 * Subcommands that download a package and RUN it, right now.
 *
 * This is the sharper end of the problem. `npx some-package` fetches and executes code immediately.
 * Nothing is written to package.json, so the pre-commit hook never sees it either, and there is no
 * second line of defence. Agents reach for npx constantly.
 */
const EXECUTE_SUBCOMMANDS = new Set(['dlx', 'exec']);

/** Commands whose whole purpose is to fetch and run a package. */
const EXECUTE_COMMANDS = new Set(['npx', 'bunx', 'pnpx']);

/** Subcommands that install whatever the lockfile says, without naming anything. */
const LOCKFILE_SUBCOMMANDS = new Set(['ci', 'install', 'i']);

/** Flags whose value is a separate token, so the value must not be read as a package name. */
const VALUE_TAKING_FLAGS = new Set([
  '--registry',
  '--prefix',
  '--workspace',
  '-w',
  '--package',
  '-p',
  '--call',
  '-c',
]);

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

/** What a command would actually do with the npm registry. */
export interface CommandIntent {
  /** Packages named on the command line, which would be added to the project. */
  installs: string[];
  /** Packages that would be downloaded and executed immediately (npx, bunx, dlx, npm exec). */
  executes: string[];
  /**
   * The command installs whatever the lockfile already says (`npm ci`, a bare `npm install`).
   * Nothing is named, so the only way to check it is to read the lockfile.
   */
  lockfile: boolean;
}

const NOTHING: CommandIntent = { installs: [], executes: [], lockfile: false };

/** Everything the command would pull from the registry, whether to install it or to run it. */
export function parseCommand(command: string): CommandIntent {
  const intent: CommandIntent = { installs: [], executes: [], lockfile: false };

  for (const segment of splitSegments(command)) {
    const found = parseSegment(segment);
    for (const name of found.installs) {
      if (!intent.installs.includes(name)) intent.installs.push(name);
    }
    for (const name of found.executes) {
      if (!intent.executes.includes(name)) intent.executes.push(name);
    }
    if (found.lockfile) intent.lockfile = true;
  }

  return intent;
}

/**
 * Just the package names a command would install or run. Kept because most callers only care about
 * "which packages should I check", not about how they arrive.
 */
export function parseInstallCommand(command: string): string[] {
  const { installs, executes } = parseCommand(command);
  return [...new Set([...installs, ...executes])];
}

/** Splits on shell separators so `cd foo && npm i x` is checked segment by segment. */
function splitSegments(command: string): string[] {
  return command
    .split(/&&|\|\||[;|&\n]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function parseSegment(segment: string): CommandIntent {
  const tokens = tokenize(segment);
  const head = tokens[0];
  if (head === undefined) {
    return NOTHING;
  }

  // `npx pkg`, `bunx pkg`, `pnpx pkg`: fetch and run, no subcommand involved.
  if (EXECUTE_COMMANDS.has(head)) {
    return { installs: [], executes: namesAfter(tokens, 1, 1), lockfile: false };
  }

  if (!PACKAGE_MANAGERS.has(head)) {
    return NOTHING;
  }

  // Flags can come before the subcommand, for example `npm --silent i left-pad`.
  let index = 1;
  while (index < tokens.length && isFlag(tokens[index]!)) {
    index += consumedBy(tokens[index]!);
  }

  const subcommand = tokens[index];

  // A bare `yarn` installs from the lockfile.
  if (subcommand === undefined) {
    return head === 'yarn' ? { ...NOTHING, lockfile: true } : NOTHING;
  }
  index += 1;

  // `pnpm dlx pkg`, `yarn dlx pkg`, `npm exec pkg`: fetch and run.
  if (EXECUTE_SUBCOMMANDS.has(subcommand)) {
    return { installs: [], executes: namesAfter(tokens, index, 1), lockfile: false };
  }

  if (!INSTALL_SUBCOMMANDS.has(subcommand) && !LOCKFILE_SUBCOMMANDS.has(subcommand)) {
    return NOTHING;
  }

  const named = namesAfter(tokens, index, Infinity);

  // Naming nothing means "install what the lockfile says". That is `npm ci`, a bare `npm install`,
  // and a fresh clone. There is no package name to read, so the lockfile has to be read instead.
  if (named.length === 0 && positionalCount(tokens, index) === 0) {
    return LOCKFILE_SUBCOMMANDS.has(subcommand) ? { ...NOTHING, lockfile: true } : NOTHING;
  }

  return { installs: named, executes: [], lockfile: false };
}

/** Reads up to `limit` package names from the positional arguments starting at `start`. */
function namesAfter(tokens: string[], start: number, limit: number): string[] {
  const names: string[] = [];

  for (let index = start; index < tokens.length && names.length < limit; index += 1) {
    const token = tokens[index]!;

    // Everything after a bare `--` is arguments to the package, not more packages.
    if (token === '--') {
      continue;
    }
    if (isFlag(token)) {
      index += consumedBy(token) - 1;
      continue;
    }

    const name = packageNameFrom(token);
    if (name !== null) {
      names.push(name);
    } else if (limit === 1) {
      // For npx, the first positional IS the package. If we cannot read it as a package name
      // (a local path, a git URL), there is nothing to check and nothing to guess at.
      return names;
    }
  }

  return names;
}

/** How many positional (non flag) arguments follow, used to tell `npm i` from `npm i pkg`. */
function positionalCount(tokens: string[], start: number): number {
  let count = 0;

  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (isFlag(token)) {
      index += consumedBy(token) - 1;
      continue;
    }
    if (token !== '--') count += 1;
  }

  return count;
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
