import { cardsInColumn, votesFor } from './reducer';
import { type Board, type Card, REACTIONS } from './types';

/**
 * Markdown export of a board: columns in order, groups as nested lists,
 * vote and reaction counts, comments under their card, then action items. Used by the server endpoint and by the
 * "copy as Markdown" button, so both produce the same text.
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
    }
  }
  lines.push('');
  return lines.join('\n');
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
  return count > 0 ? `· ${count} vote${count === 1 ? '' : 's'}` : '';
}
