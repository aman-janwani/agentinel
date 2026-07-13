// The one place warnings get worded, so the Claude Code hook, the pre-commit hook, and
// `asen check` all say the same thing.
//
// Two renderings of the same verdict. formatVerdict is for a terminal, and colours itself for the
// stream it is actually going to. plainVerdict is for the JSON payloads Claude Code reads, which
// must never contain escape codes.

import type { Verdict } from '../types.js';

const RESET = '[0m';
const YELLOW = '[33m';
const RED = '[31m';
const DIM = '[2m';

export type Stream = { isTTY?: boolean };

/**
 * Colour is decided against the stream the text is going to. The hooks write to stderr, so
 * checking stdout would have been asking the wrong question.
 */
export function supportsColor(stream: Stream = process.stdout): boolean {
  return stream.isTTY === true && !process.env.NO_COLOR;
}

function painter(color: boolean) {
  return (code: string, text: string): string => (color ? `${code}${text}${RESET}` : text);
}

/** The lines of a verdict, unstyled. Null when there is nothing worth saying. */
function lines(verdict: Verdict): string[] | null {
  switch (verdict.kind) {
    case 'clean':
    case 'allowlisted':
      return null;

    case 'flagged':
      return [
        `⚠ agentsentinel: ${verdict.name} looks suspicious`,
        `  registered ${days(verdict.ageDays)} ago · ${downloads(verdict.downloads)}/month`,
        '  this pattern matches known "slopsquatting" attacks',
        `  → run \`asen allow ${verdict.name} --reason "..."\` to silence this`,
      ];

    case 'not-found':
      return [
        `✗ agentsentinel: ${verdict.name} does not exist on the npm registry`,
        '  no package by that name is published publicly, so this install will fail',
        '  a name an agent invented is exactly what a slopsquatter waits to register',
        '  → check the spelling before installing anything under this name',
      ];

    case 'skipped':
      return [
        `agentsentinel: could not check ${verdict.name} (${verdict.reason})`,
        '  the check did not run, and nothing was blocked',
      ];
  }
}

/** For a terminal. Returns the text to print, or null when there is nothing worth saying. */
export function formatVerdict(verdict: Verdict, stream: Stream = process.stdout): string | null {
  const body = lines(verdict);
  if (body === null) {
    return null;
  }

  const paint = painter(supportsColor(stream));
  const color = verdict.kind === 'not-found' ? RED : verdict.kind === 'flagged' ? YELLOW : DIM;

  return body.map((line, index) => paint(index === body.length - 1 ? DIM : color, line)).join('\n');
}

/** For JSON payloads Claude Code reads. Never coloured. */
export function plainVerdict(verdict: Verdict): string | null {
  const body = lines(verdict);
  return body === null ? null : body.join('\n');
}

/** Everything worth telling the user about, as one plain block. Null when there is nothing. */
export function plainSummary(verdicts: Verdict[]): string | null {
  const blocks = verdicts.map(plainVerdict).filter((block): block is string => block !== null);
  return blocks.length === 0 ? null : blocks.join('\n');
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
