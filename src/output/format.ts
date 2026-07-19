// The one place warnings get worded and laid out, so every hook and command says the same thing
// and looks like the same tool.
//
// formatVerdict is for a terminal and colours itself for the stream it is going to. plainVerdict is
// for the JSON that agents read, which must never contain escape codes.

import type { Reason, Verdict } from '../types.js';
import { isConfirmed } from '../types.js';

export const RESET = '\x1b[0m';
export const YELLOW = '\x1b[33m';
export const RED = '\x1b[31m';
export const GREEN = '\x1b[32m';
export const CYAN = '\x1b[36m';
export const DIM = '\x1b[2m';
export const BOLD = '\x1b[1m';

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

/** One line per reason, in plain language. This is what the user actually reads. */
export function describeReason(reason: Reason): string {
  switch (reason.kind) {
    case 'known-malware':
      return 'listed as malware on the public advisory database';
    case 'security-hold':
      return 'npm has taken this package down for security';
    case 'new-and-unpopular':
      return `registered ${days(reason.ageDays)} ago, ${downloads(reason.downloads)} last month`;
    case 'publisher-drift':
      return `published by ${reason.now}, but previous versions came from ${reason.before}`;
    case 'no-track-record':
      return `no repository, only one version ever, ${downloads(reason.downloads)} last month`;
    case 'size-jump':
      return `a small version bump, but the code grew from ${size(reason.before)} to ${size(reason.now)}`;
  }
}

interface Banner {
  heading: string;
  body: string[];
  action?: string;
  tone: 'warn' | 'bad' | 'quiet';
}

function banner(verdict: Verdict): Banner | null {
  switch (verdict.kind) {
    case 'clean':
    case 'allowlisted':
      return null;

    case 'flagged': {
      // Confirmed malware is a fact. Everything else is a suspicion. Saying both in the same tone
      // would waste the strongest signal we have.
      const confirmed = verdict.reasons.some(isConfirmed);
      const body = [verdict.name, ''];
      for (const reason of verdict.reasons) {
        body.push(`- ${describeReason(reason)}`);
      }
      if (!confirmed) {
        body.push('', 'This is the pattern slopsquatting attacks use.');
      }

      return {
        heading: confirmed ? 'MALICIOUS PACKAGE' : 'SUSPICIOUS PACKAGE',
        body,
        action: confirmed
          ? 'Do not install this. It is known malware.'
          : `Trust it:  asen allow ${verdict.name} --reason "..."`,
        tone: confirmed ? 'bad' : 'warn',
      };
    }

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
  const text = inner - 1;
  const color = b.tone === 'bad' ? RED : b.tone === 'warn' ? YELLOW : DIM;

  const top = paint(color, `╭─ ${TITLE} ${'─'.repeat(WIDTH - TITLE.length - 5)}╮`);
  const bottom = paint(color, `╰${'─'.repeat(WIDTH - 2)}╯`);

  const rows: string[] = [];
  const push = (line: string, styled?: string) => {
    const edge = paint(color, '│');
    const pad = ' '.repeat(Math.max(0, inner - line.length));
    rows.push(`${edge}  ${styled ?? line}${pad}${edge}`);
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

export function drawSuccessBox(
  heading: string,
  body: string[],
  stream: Stream = process.stdout,
): string {
  const inner = WIDTH - 4;
  const text = inner - 1;
  const color = supportsColor(stream) ? GREEN : '';
  const paint = (code: string, str: string): string =>
    supportsColor(stream) ? `${code}${str}${RESET}` : str;

  const top = paint(color, `╭─ ${paint(BOLD, TITLE)} ${'─'.repeat(WIDTH - TITLE.length - 5)}╮`);
  const bottom = paint(color, `╰${'─'.repeat(WIDTH - 2)}╯`);

  const rows: string[] = [];
  const push = (line: string, styled?: string) => {
    const edge = paint(color, '│');
    // Remove ANSI sequences for length calculation
    const plainLine = (styled ?? line).replace(/\x1b\[[0-9;]*m/g, '');
    const pad = ' '.repeat(Math.max(0, inner - plainLine.length));
    rows.push(`${edge}  ${styled ?? line}${pad}${edge}`);
  };

  push(heading, paint(BOLD, heading));
  push('');

  for (const line of body) {
    if (line === '') {
      push('');
      continue;
    }

    // We only support simple wrapping for lines without ANSI codes inside the body for now,
    // but the init command will format things carefully.
    if (line.includes('\x1b')) {
      push(line, line);
    } else {
      for (const wrapped of wrap(line, text)) {
        push(wrapped);
      }
    }
  }

  return [top, ...rows, bottom].join('\n');
}

function wrap(line: string, width: number): string[] {
  const lines: string[] = [];
  let current = '';

  for (const word of line.split(' ')) {
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
  return lines.flatMap((l) =>
    l.length <= width ? [l] : (l.match(new RegExp(`.{1,${width}}`, 'g')) ?? [l]),
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

/** For the JSON that agents read. Never coloured. */
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
 * The reason an agent is shown when strict mode blocks the call. Prose, not a box: the agent reads
 * it as much as the person does, and it needs to say what to do instead.
 */
export function denyReason(verdicts: Verdict[]): string {
  const problems: string[] = [];

  for (const verdict of verdicts) {
    if (verdict.kind === 'flagged') {
      const why = verdict.reasons.map(describeReason).join('; ');
      problems.push(`${verdict.name} (${why})`);
    } else if (verdict.kind === 'not-found') {
      problems.push(`${verdict.name} (does not exist on the npm registry)`);
    }
  }

  if (problems.length === 0) {
    return 'Blocked by agentinel.';
  }

  return (
    `Blocked by agentinel: ${problems.join(', ')}. ` +
    'Verify the package, pick an established alternative, or allowlist it with ' +
    '`asen allow <pkg> --reason "..."`.'
  );
}

function days(count: number): string {
  return count === 1 ? '1 day' : `${count} days`;
}

function downloads(count: number): string {
  return count === 1 ? '1 download' : `${count.toLocaleString('en-US')} downloads`;
}

function size(bytes: number): string {
  const kb = bytes / 1024;
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)}MB` : `${Math.round(kb)}KB`;
}
