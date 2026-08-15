import { describe, expect, it } from 'vitest';
import {
  isValidCargoCrate,
  isValidPypiName,
  parseCargoCommand,
  parsePipCommand,
} from '../src/checks/package-guard/parse-install.js';

// ─── isValidPypiName ────────────────────────────────────────────────────────

describe('isValidPypiName', () => {
  it('accepts simple names', () => {
    expect(isValidPypiName('requests')).toBe(true);
    expect(isValidPypiName('numpy')).toBe(true);
    expect(isValidPypiName('my-package')).toBe(true);
    expect(isValidPypiName('my_package')).toBe(true);
    expect(isValidPypiName('my.package')).toBe(true);
  });

  it('rejects names with invalid characters', () => {
    expect(isValidPypiName('')).toBe(false);
    expect(isValidPypiName('pkg space')).toBe(false);
    expect(isValidPypiName('-starts-with-dash')).toBe(false);
    expect(isValidPypiName('ends-with-dash-')).toBe(false);
  });
});

// ─── isValidCargoCrate ──────────────────────────────────────────────────────

describe('isValidCargoCrate', () => {
  it('accepts valid crate names', () => {
    expect(isValidCargoCrate('serde')).toBe(true);
    expect(isValidCargoCrate('tokio')).toBe(true);
    expect(isValidCargoCrate('my-crate')).toBe(true);
    expect(isValidCargoCrate('my_crate')).toBe(true);
  });

  it('rejects names starting with a digit', () => {
    expect(isValidCargoCrate('1invalid')).toBe(false);
  });

  it('rejects empty or too long names', () => {
    expect(isValidCargoCrate('')).toBe(false);
    expect(isValidCargoCrate('a'.repeat(65))).toBe(false);
  });
});

// ─── parsePipCommand ────────────────────────────────────────────────────────

describe('parsePipCommand', () => {
  it('parses pip install', () => {
    expect(parsePipCommand('pip install requests')).toEqual(['requests']);
  });

  it('parses pip3 install', () => {
    expect(parsePipCommand('pip3 install flask')).toEqual(['flask']);
  });

  it('parses python -m pip install', () => {
    expect(parsePipCommand('python -m pip install django')).toEqual(['django']);
  });

  it('parses python3 -m pip install', () => {
    expect(parsePipCommand('python3 -m pip install numpy')).toEqual(['numpy']);
  });

  it('strips version specifiers', () => {
    expect(parsePipCommand('pip install requests==2.28.0')).toEqual(['requests']);
    // Shell would strip quotes; once unquoted, flask>=2.0 is handled by pypiNameFrom
    expect(parsePipCommand('pip install flask>=2.0')).toEqual(['flask']);
  });

  it('strips extras', () => {
    expect(parsePipCommand('pip install requests[security]')).toEqual(['requests']);
  });

  it('parses multiple packages', () => {
    expect(parsePipCommand('pip install requests flask django')).toEqual([
      'requests',
      'flask',
      'django',
    ]);
  });

  it('skips flags and their values', () => {
    expect(parsePipCommand('pip install -r requirements.txt requests')).toEqual(['requests']);
    expect(parsePipCommand('pip install --index-url https://example.com requests')).toEqual([
      'requests',
    ]);
  });

  it('returns nothing for non-install subcommands', () => {
    expect(parsePipCommand('pip freeze')).toEqual([]);
    expect(parsePipCommand('pip list')).toEqual([]);
    expect(parsePipCommand('pip uninstall requests')).toEqual([]);
  });

  it('returns nothing for non-pip commands', () => {
    expect(parsePipCommand('npm install express')).toEqual([]);
    expect(parsePipCommand('cargo add serde')).toEqual([]);
  });

  it('handles chained commands', () => {
    expect(parsePipCommand('cd mydir && pip install requests')).toEqual(['requests']);
  });

  it('returns nothing when python is called without -m pip', () => {
    expect(parsePipCommand('python script.py')).toEqual([]);
    expect(parsePipCommand('python3 manage.py runserver')).toEqual([]);
  });
});

// ─── parseCargoCommand ──────────────────────────────────────────────────────

describe('parseCargoCommand', () => {
  it('parses cargo add', () => {
    expect(parseCargoCommand('cargo add serde')).toEqual(['serde']);
  });

  it('parses cargo install', () => {
    expect(parseCargoCommand('cargo install ripgrep')).toEqual(['ripgrep']);
  });

  it('parses multiple crates', () => {
    expect(parseCargoCommand('cargo add serde tokio anyhow')).toEqual(['serde', 'tokio', 'anyhow']);
  });

  it('strips version specifiers', () => {
    expect(parseCargoCommand('cargo add serde@1.0')).toEqual(['serde']);
  });

  it('skips flags', () => {
    expect(parseCargoCommand('cargo add --features derive serde')).toEqual(['serde']);
    expect(parseCargoCommand('cargo add serde --no-default-features')).toEqual(['serde']);
  });

  it('returns nothing for non-install subcommands', () => {
    expect(parseCargoCommand('cargo build')).toEqual([]);
    expect(parseCargoCommand('cargo test')).toEqual([]);
    expect(parseCargoCommand('cargo run')).toEqual([]);
  });

  it('returns nothing for non-cargo commands', () => {
    expect(parseCargoCommand('npm install express')).toEqual([]);
    expect(parseCargoCommand('pip install requests')).toEqual([]);
  });

  it('handles chained commands', () => {
    expect(parseCargoCommand('cd mydir && cargo add serde')).toEqual(['serde']);
  });
});
