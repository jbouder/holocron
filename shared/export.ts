import { cardsInColumn, votesFor } from './reducer';
import type { Board, Card } from './types';

/**
 * Markdown export of a board: columns in order, groups as nested lists,
 * vote counts, then action items. Used by the server endpoint and by the
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
  const author = card.anonymous ? '' : ` _(${card.authorName})_`;
  const votes = withVotes ? ` ${voteBadge(votesFor(board, card.id))}` : '';
  return `${card.text.replace(/\s*\n\s*/g, ' ')}${author}${votes}`.trimEnd();
}

function voteBadge(count: number): string {
  return count > 0 ? `· ${count} vote${count === 1 ? '' : 's'}` : '';
}
