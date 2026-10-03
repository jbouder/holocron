import { cardsInColumn, votesFor } from './reducer';
import { type ActionItem, type Board, type Card, REACTIONS } from './types';

/**
 * Everything here is shared by the server endpoints (`/export.md`,
 * `/export.csv`, `/export.txt`) and the export dialog, so a download and a
 * copy always match. No format ever prints the author of an anonymous card
 * or comment.
 */

export type ExportFormat = 'md' | 'csv' | 'txt';

export const EXPORT_FORMATS: Record<
  ExportFormat,
  { label: string; contentType: string }
> = {
  md: { label: 'Markdown', contentType: 'text/markdown; charset=utf-8' },
  csv: { label: 'CSV', contentType: 'text/csv; charset=utf-8' },
  txt: { label: 'Summary', contentType: 'text/plain; charset=utf-8' },
};

export function isExportFormat(value: string): value is ExportFormat {
  return Object.hasOwn(EXPORT_FORMATS, value);
}

export function exportBoard(
  board: Board,
  format: ExportFormat,
  now = Date.now(),
): string {
  switch (format) {
    case 'md':
      return boardToMarkdown(board, now);
    case 'csv':
      return actionItemsToCsv(board);
    case 'txt':
      return boardToSummary(board, now);
  }
}

/**
 * Markdown export of a board: columns in order, groups as nested lists,
 * vote and reaction counts, comments under their card, then action items
 * with the card each came from.
 */
export function boardToMarkdown(board: Board, now = Date.now()): string {
  const lines: string[] = [];
  lines.push(`# ${board.title}`);
  lines.push('');
  lines.push(
    `Retro board \`${board.code}\` · exported ${new Date(now).toISOString().slice(0, 16).replace('T', ' ')} UTC`,
  );
  lines.push('');

  for (const column of [...board.columns].sort(
    (a, b) => a.position - b.position,
  )) {
    lines.push(`## ${column.title}`);
    lines.push('');
    if (column.prompt) {
      lines.push(`_${column.prompt}_`);
      lines.push('');
    }
    const cards = cardsInColumn(board, column.id);
    if (cards.length === 0) {
      lines.push('_No cards._');
      lines.push('');
      continue;
    }
    const seenGroups = new Set<string>();
    for (const card of cards) {
      if (card.groupId === null) {
        lines.push(`- ${cardLine(board, card)}`);
        lines.push(...commentLines(board, card, '  '));
        continue;
      }
      if (seenGroups.has(card.groupId)) {
        continue;
      }
      seenGroups.add(card.groupId);
      const members = cards.filter((c) => c.groupId === card.groupId);
      const total = members.reduce((sum, c) => sum + votesFor(board, c.id), 0);
      lines.push(`- **Group** ${voteBadge(total)}`);
      for (const member of members) {
        lines.push(`  - ${cardLine(board, member, false)}`);
        lines.push(...commentLines(board, member, '    '));
      }
    }
    lines.push('');
  }

  lines.push('## Action items');
  lines.push('');
  if (board.actionItems.length === 0) {
    lines.push('_None yet._');
  } else {
    for (const item of board.actionItems) {
      const owner = item.owner ? ` — ${item.owner}` : '';
      lines.push(`- [${item.done ? 'x' : ' '}] ${item.text}${owner}`);
      const source = linkedCard(board, item);
      if (source) {
        lines.push(`  - From: ${oneLine(source.text)}`);
      }
    }
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Action items as CSV for a tracker import (Jira, Linear). RFC 4180 quoting;
 * cells that a spreadsheet would read as a formula are defused with a quote.
 */
export function actionItemsToCsv(board: Board): string {
  const rows = [['Summary', 'Owner', 'Done', 'Card']];
  for (const item of board.actionItems) {
    rows.push([
      item.text,
      item.owner,
      item.done ? 'yes' : 'no',
      linkedCard(board, item)?.text ?? '',
    ]);
  }
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

/** How many of the most-voted cards the summary lists. */
export const SUMMARY_TOP_CARDS = 5;

/**
 * A short plain-text summary for a chat message: the title, the most-voted
 * cards (a group counts once, with its combined votes) and the action items.
 */
export function boardToSummary(board: Board, now = Date.now()): string {
  const lines = [`${board.title} · retro ${formatDate(now)}`];

  const stacks: { text: string; votes: number; extra: number }[] = [];
  const seenGroups = new Set<string>();
  for (const column of [...board.columns].sort(
    (a, b) => a.position - b.position,
  )) {
    for (const card of cardsInColumn(board, column.id)) {
      if (card.groupId === null) {
        stacks.push({
          text: card.text,
          votes: votesFor(board, card.id),
          extra: 0,
        });
        continue;
      }
      if (seenGroups.has(card.groupId)) {
        continue;
      }
      seenGroups.add(card.groupId);
      const members = board.cards.filter((c) => c.groupId === card.groupId);
      stacks.push({
        text: card.text,
        votes: members.reduce((sum, c) => sum + votesFor(board, c.id), 0),
        extra: members.length - 1,
      });
    }
  }
  // Stable sort: ties keep column order.
  const top = stacks
    .filter((s) => s.votes > 0)
    .sort((a, b) => b.votes - a.votes)
    .slice(0, SUMMARY_TOP_CARDS);
  if (top.length > 0) {
    lines.push('');
    lines.push('Top voted');
    for (const s of top) {
      const extra = s.extra > 0 ? ` (+${s.extra} similar)` : '';
      lines.push(`• ${oneLine(s.text)}${extra} (${voteCount(s.votes)})`);
    }
  }

  lines.push('');
  lines.push('Action items');
  if (board.actionItems.length === 0) {
    lines.push('None yet.');
  }
  for (const item of board.actionItems) {
    const owner = item.owner ? ` (${item.owner})` : '';
    lines.push(`${item.done ? '☑' : '☐'} ${oneLine(item.text)}${owner}`);
  }
  return `${lines.join('\n')}\n`;
}

function linkedCard(board: Board, item: ActionItem): Card | undefined {
  return item.cardId === null
    ? undefined
    : board.cards.find((c) => c.id === item.cardId);
}

/** Leading characters a spreadsheet treats as the start of a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function formatDate(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function cardLine(board: Board, card: Card, withVotes = true): string {
  const parts = [oneLine(card.text)];
  if (!card.anonymous) {
    parts.push(`_(${card.authorName})_`);
  }
  const votes = withVotes ? voteBadge(votesFor(board, card.id)) : '';
  if (votes) {
    parts.push(votes);
  }
  const reactions = reactionBadge(board, card.id);
  if (reactions) {
    parts.push(reactions);
  }
  return parts.join(' ');
}

function commentLines(board: Board, card: Card, indent: string): string[] {
  return board.comments
    .filter((c) => c.cardId === card.id)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((c) => {
      const author = c.anonymous ? '' : ` _(${c.authorName})_`;
      return `${indent}- 💬 ${oneLine(c.text)}${author}`;
    });
}

/** e.g. "· 👍 3 🎉 1", in the fixed reaction order; empty when none. */
function reactionBadge(board: Board, cardId: string): string {
  const parts: string[] = [];
  for (const { emoji } of REACTIONS) {
    let count = 0;
    for (const r of board.reactions) {
      if (r.cardId === cardId && r.emoji === emoji) {
        count += 1;
      }
    }
    if (count > 0) {
      parts.push(`${emoji} ${count}`);
    }
  }
  return parts.length > 0 ? `· ${parts.join(' ')}` : '';
}

function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ');
}

function voteBadge(count: number): string {
  return count > 0 ? `· ${voteCount(count)}` : '';
}

function voteCount(count: number): string {
  return `${count} vote${count === 1 ? '' : 's'}`;
}
