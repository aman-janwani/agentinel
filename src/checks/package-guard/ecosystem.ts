/**
 * Identifies which package registry a package belongs to.
 *
 * The malware list stores entries as "ecosystem/name" (e.g. "pypi/requests", "cargo/serde")
 * so a compromised PyPI name never collides with an npm name of the same string.
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
  return { ecosystem, name, key: `${ecosystem}/${name}` };
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
