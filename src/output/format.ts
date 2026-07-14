// The one place warnings get worded and laid out, so the Claude Code hook, the pre-commit hook,
// and `asen check` all say the same thing and look like the same tool.
//
// Two renderings of the same verdict. formatVerdict is for a terminal and colours itself for the
// stream it is going to. plainVerdict is for the JSON that Claude Code reads, which must never
// contain escape codes. Both use the same box, so the tool has one identity wherever you meet it.

import type { Verdict } from '../types.js';

const RESET = '[0m';
const YELLOW = '[33m';
const RED = '[31m';
const DIM = '[2m';

/** Wide enough to read, narrow enough to survive a split terminal pane. */
const WIDTH = 46;
const TITLE = 'agentinel';

export type Stream = { isTTY?: boolean };

/**
 * Colour is decided against the stream the text is going to. The hooks write to stderr, so
 * checking stdout would have been asking the wrong question.
 */
export function supportsColor(stream: Stream = process.stdout): boolean {
  return stream.isTTY === true && !process.env.NO_COLOR;
}

interface Banner {
  heading: string;
  body: string[];
  /** Printed under the box, not inside it. The thing to do next. */
  action?: string;
  tone: 'warn' | 'bad' | 'quiet';
}

function banner(verdict: Verdict): Banner | null {
  switch (verdict.kind) {
    case 'clean':
    case 'allowlisted':
      return null;

    case 'flagged':
      return {
        heading: 'SUSPICIOUS PACKAGE',
        body: [
          verdict.name,
          `registered ${days(verdict.ageDays)} ago`,
          `${downloads(verdict.downloads)} in the last month`,
          '',
          'Both signals trip. This is the pattern slopsquatting attacks use.',
        ],
        action: `Trust it:  asen allow ${verdict.name} --reason "..."`,
        tone: 'warn',
      };

    case 'not-found':
      return {
        heading: 'PACKAGE DOES NOT EXIST',
        body: [
          verdict.name,
          '',
          'No package by that name is published on npm, so this install will fail.',
          'A name an agent invented is exactly what a slopsquatter waits to register.',
        ],
        action: 'Check the spelling before installing anything under this name.',
        tone: 'bad',
      };

    case 'skipped':
      return {
        heading: 'CHECK SKIPPED',
        body: [verdict.name, '', verdict.reason, 'Nothing was blocked.'],
        tone: 'quiet',
      };
  }
}

/** Draws the box. Content is wrapped to fit, so a long package name cannot break the border. */
function draw(b: Banner, paint: (code: string, text: string) => string): string {
  const inner = WIDTH - 4;
  // Wrap a character short of the padding so text never sits flush against the right border.
  const text = inner - 1;
  const color = b.tone === 'bad' ? RED : b.tone === 'warn' ? YELLOW : DIM;

  const top = paint(color, `╭─ ${TITLE} ${'─'.repeat(WIDTH - TITLE.length - 5)}╮`);
  const bottom = paint(color, `╰${'─'.repeat(WIDTH - 2)}╯`);

  const rows: string[] = [];
  const push = (text: string, styled?: string) => {
    const edge = paint(color, '│');
    const pad = ' '.repeat(Math.max(0, inner - text.length));
    rows.push(`${edge}  ${styled ?? text}${pad}${edge}`);
  };

  push(b.heading, paint(color, b.heading));
  push('');

  for (const line of b.body) {
    if (line === '') {
      push('');
      continue;
    }
    for (const wrapped of wrap(line, text)) {
      push(wrapped);
    }
  }

  const box = [top, ...rows, bottom].join('\n');
  return b.action ? `${box}\n  ${paint(DIM, b.action)}` : box;
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let current = '';

  for (const word of text.split(' ')) {
    if (current === '') {
      current = word;
    } else if (`${current} ${word}`.length <= width) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== '') {
    lines.push(current);
  }

  // A single word longer than the box, for example a very long package name, still has to fit.
  return lines.flatMap((line) =>
    line.length <= width ? [line] : (line.match(new RegExp(`.{1,${width}}`, 'g')) ?? [line]),
  );
}

/** For a terminal. Returns the text to print, or null when there is nothing worth saying. */
export function formatVerdict(verdict: Verdict, stream: Stream = process.stdout): string | null {
  const b = banner(verdict);
  if (b === null) {
    return null;
  }

  const color = supportsColor(stream);
  const paint = (code: string, text: string): string => (color ? `${code}${text}${RESET}` : text);

  return draw(b, paint);
}

/** For the JSON that Claude Code reads. Never coloured. */
export function plainVerdict(verdict: Verdict): string | null {
  const b = banner(verdict);
  return b === null ? null : draw(b, (_code, text) => text);
}

/** Everything worth telling the user about, as one plain block. Null when there is nothing. */
export function plainSummary(verdicts: Verdict[]): string | null {
  const blocks = verdicts.map(plainVerdict).filter((block): block is string => block !== null);
  return blocks.length === 0 ? null : blocks.join('\n\n');
}

/**
 * The reason Claude Code shows when strict mode blocks the call. This one is prose, not a box:
 * Claude reads it as much as the person does, and it needs to say what to do instead.
 */
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
    return 'Blocked by agentinel.';
  }

  return (
    `Blocked by agentinel: ${problems.join(', ')}. ` +
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
