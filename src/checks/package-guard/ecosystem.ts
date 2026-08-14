/**
 * Identifies which package registry a package belongs to.
 *
 * To avoid collisions between ecosystems, the malware list keys PyPI and Cargo packages
 * as "pypi/name" and "cargo/name". npm packages remain bare names (e.g. "chalk")
 * for backward compatibility.
 */
export type Ecosystem = 'npm' | 'pypi' | 'cargo';

/**
 * A package name qualified with the registry it comes from.
 * The `display` field is the raw string the user typed (e.g. "requests", "serde").
 * The `key` field is the malware-list key (e.g. "pypi/requests", "cargo/serde").
 */
export interface QualifiedPackage {
  ecosystem: Ecosystem;
  name: string;
  /** How the package is keyed in the malware list. */
  key: string;
}

export function qualify(ecosystem: Ecosystem, name: string): QualifiedPackage {
  const key = ecosystem === 'npm' ? name : `${ecosystem}/${name}`;
  return { ecosystem, name, key };
}

/**
 * Normalises a PyPI package name.
 * PyPI treats hyphens, underscores, and dots as equivalent and lowercases everything.
 * https://peps.python.org/pep-0503/#normalized-names
 */
export function normalisePypi(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

/**
 * Normalises a crates.io crate name.
 * Cargo names are case-sensitive but are conventionally lowercase with underscores.
 * We preserve the casing the user typed because that is what the crates.io API expects.
 */
export function normaliseCargo(name: string): string {
  return name.trim();
}
