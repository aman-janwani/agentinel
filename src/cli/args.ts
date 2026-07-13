/** Flags whose value is the next argument, so that value is not a positional. */
const VALUE_TAKING_FLAGS = new Set(['--reason']);

/**
 * The arguments that are not flags and not the value of a flag. Without the second part,
 * `asen allow --reason "vetted" my-pkg` would read "vetted" as the package name.
 */
export function positionals(args: string[]): string[] {
  const found: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg.startsWith('-')) {
      if (VALUE_TAKING_FLAGS.has(arg)) {
        index += 1;
      }
      continue;
    }
    found.push(arg);
  }

  return found;
}

/** Reads `--flag value` or `--flag=value`. */
export function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index !== -1) {
    return args[index + 1];
  }

  const inline = args.find((arg) => arg.startsWith(`${flag}=`));
  return inline ? inline.slice(flag.length + 1) : undefined;
}
