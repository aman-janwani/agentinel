// The one place warnings get rendered, so the Claude Code hook, the pre-commit hook, and
// `asen check` all say the same thing in the same words.

import type { Verdict } from '../types.js';

const RESET = '[0m';
const YELLOW = '[33m';
const RED = '[31m';
const DIM = '[2m';

function useColor(): boolean {
  return process.stdout.isTTY === true && !process.env.NO_COLOR;
}

function paint(code: string, text: string): string {
  return useColor() ? `${code}${text}${RESET}` : text;
}

const yellow = (text: string): string => paint(YELLOW, text);
const red = (text: string): string => paint(RED, text);
const dim = (text: string): string => paint(DIM, text);

/** Returns the text to print, or null when there is nothing worth saying. */
export function formatVerdict(verdict: Verdict): string | null {
  switch (verdict.kind) {
    case 'clean':
    case 'allowlisted':
      return null;

    case 'flagged':
      return [
        yellow(`⚠ agentsentinel: ${verdict.name} looks suspicious`),
        yellow(`  registered ${days(verdict.ageDays)} ago · ${downloads(verdict.downloads)}/month`),
        yellow('  this pattern matches known "slopsquatting" attacks'),
        dim(`  → run \`asen allow ${verdict.name} --reason "..."\` to silence this`),
      ].join('\n');

    case 'not-found':
      return [
        red(`✗ agentsentinel: ${verdict.name} does not exist on the npm registry`),
        red('  no package by that name is published publicly, so this install will fail'),
        red('  a name an agent invented is exactly what a slopsquatter waits to register'),
        dim('  → check the spelling before installing anything under this name'),
      ].join('\n');

    case 'skipped':
      return [
        dim(`agentsentinel: could not check ${verdict.name} (${verdict.reason})`),
        dim('  the check did not run, and nothing was blocked'),
      ].join('\n');
  }
}

/** Plain text reason for Claude Code's strict-mode deny payload. Goes into JSON, so no colors. */
export function denyReason(verdicts: Verdict[]): string {
  const problems: string[] = [];

  for (const verdict of verdicts) {
    if (verdict.kind === 'flagged') {
      problems.push(
        `${verdict.name} (registered ${days(verdict.ageDays)} ago, ` +
          `${downloads(verdict.downloads)}/month)`,
      );
    } else if (verdict.kind === 'not-found') {
      problems.push(`${verdict.name} (does not exist on the npm registry)`);
    }
  }

  if (problems.length === 0) {
    return 'Blocked by agentsentinel.';
  }

  return (
    `Blocked by agentsentinel: ${problems.join(', ')}. ` +
    'This matches the slopsquatting pattern. Verify the package, pick an established ' +
    'alternative, or allowlist it with `asen allow <pkg> --reason "..."`.'
  );
}

function days(count: number): string {
  return count === 1 ? '1 day' : `${count} days`;
}

function downloads(count: number): string {
  return count === 1 ? '1 download' : `${count.toLocaleString('en-US')} downloads`;
}
