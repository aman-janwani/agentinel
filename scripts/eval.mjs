// The accuracy gate. Run before any release, and publish the numbers.
//
// A security tool dies of false positives, not of missed threats. One warning on a package someone
// legitimately depends on and the tool is uninstalled that afternoon. So the bar is:
//
//   every known-bad package is caught, and NOTHING in the top packages is flagged.
//
// Run with: node scripts/eval.mjs

import { execFileSync } from 'node:child_process';

const KNOWN_BAD = [
  'unused-imports', // real slopsquat, npm security-held
  'crossenv', // the classic typosquat, npm security-held
  'react-codeshift', // hallucinated name, no repo, one version
  'legible-mutex', // real, brand new, no downloads
];

// The packages a false positive would be most expensive on: the ones everybody depends on.
const MUST_BE_CLEAN = [
  'react',
  'react-dom',
  'next',
  'vue',
  'svelte',
  'angular',
  'express',
  'fastify',
  'koa',
  'nest',
  'lodash',
  'underscore',
  'ramda',
  'zod',
  'yup',
  'joi',
  'clsx',
  'classnames',
  'date-fns',
  'dayjs',
  'moment',
  'axios',
  'node-fetch',
  'got',
  'ky',
  'chalk',
  'colors',
  'picocolors',
  'debug',
  'ms',
  'commander',
  'yargs',
  'minimist',
  'dotenv',
  'cross-env',
  'eslint',
  'prettier',
  'typescript',
  'tslib',
  'vitest',
  'jest',
  'mocha',
  'chai',
  'sinon',
  'playwright',
  'puppeteer',
  'cypress',
  'tailwindcss',
  'postcss',
  'autoprefixer',
  'sass',
  'less',
  'esbuild',
  'vite',
  'webpack',
  'rollup',
  'parcel',
  'tsup',
  'prisma',
  'drizzle-orm',
  'mongoose',
  'sequelize',
  'knex',
  'pg',
  'mysql2',
  'redis',
  'ioredis',
  'sqlite3',
  'socket.io',
  'ws',
  'uuid',
  'nanoid',
  'jsonwebtoken',
  'bcrypt',
  'argon2',
  'cors',
  'helmet',
  'morgan',
  'multer',
  'sharp',
  'husky',
  'lint-staged',
  'zustand',
  'jotai',
  'redux',
  'swr',
  'react-query',
  'react-router',
  'react-hook-form',
  'framer-motion',
  'three',
  'd3',
  'chart.js',
  'recharts',
  'rxjs',
  'immer',
  'semver',
  'glob',
  'rimraf',
  'fs-extra',
  'execa',
  'ora',
  'inquirer',
  'boxen',
  'figlet',
];

function check(name) {
  try {
    const out = execFileSync('node', ['dist/asen.js', 'check', name], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return classify(out);
  } catch (error) {
    // asen exits non-zero when it flags something, which is not a failure of the eval.
    return classify(String(error.stdout ?? '') + String(error.stderr ?? ''));
  }
}

function classify(out) {
  if (out.includes('MALICIOUS PACKAGE')) return 'malicious';
  if (out.includes('SUSPICIOUS PACKAGE')) return 'suspicious';
  if (out.includes('PACKAGE DOES NOT EXIST')) return 'not-found';
  if (out.includes('CHECK SKIPPED')) return 'skipped';
  return 'clean';
}

const caught = [];
const missed = [];
for (const name of KNOWN_BAD) {
  const verdict = check(name);
  (verdict === 'clean' || verdict === 'skipped' ? missed : caught).push(`${name} (${verdict})`);
}

const falsePositives = [];
const skipped = [];
for (const name of MUST_BE_CLEAN) {
  const verdict = check(name);
  if (verdict === 'skipped') skipped.push(name);
  else if (verdict !== 'clean') falsePositives.push(`${name} (${verdict})`);
}

const checked = MUST_BE_CLEAN.length - skipped.length;

console.log('\n=== KNOWN BAD: every one must be caught ===');
console.log(`  caught : ${caught.length}/${KNOWN_BAD.length}  ${caught.join(', ')}`);
if (missed.length) console.log(`  MISSED : ${missed.join(', ')}`);

console.log('\n=== WIDELY USED: none may be flagged ===');
console.log(`  checked         : ${checked}`);
console.log(
  `  false positives : ${falsePositives.length}  ${falsePositives.join(', ') || '(none)'}`,
);
if (skipped.length) console.log(`  could not check : ${skipped.length} (${skipped.join(', ')})`);

const pass = missed.length === 0 && falsePositives.length === 0;
console.log(
  `\n${pass ? 'PASS' : 'FAIL'}: ${caught.length}/${KNOWN_BAD.length} caught, ${falsePositives.length} false positives in ${checked} popular packages\n`,
);
process.exit(pass ? 0 : 1);
