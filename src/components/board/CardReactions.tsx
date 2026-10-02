import { SmileyIcon } from '@phosphor-icons/react';
import type { Op, You } from '#shared/protocol';
import { type Board, type Card, REACTIONS } from '#shared/types';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface Tally {
  emoji: (typeof REACTIONS)[number]['emoji'];
  label: string;
  count: number;
  mine: boolean;
  names: string[];
}

/** Reactions on one card in the fixed order, with who left them. */
function tally(board: Board, card: Card, you: You): Tally[] {
  return REACTIONS.map(({ emoji, label }) => {
    const on = board.reactions.filter(
      (r) => r.cardId === card.id && r.emoji === emoji,
    );
    return {
      emoji,
      label,
      count: on.length,
      mine: on.some((r) => r.participantId === you.id),
      names: on.map((r) =>
        r.participantId === you.id
          ? 'You'
          : (board.participants.find((p) => p.id === r.participantId)?.name ??
            'Someone'),
      ),
    };
  });
}

/** The chips under a card's text, one per emoji someone used. */
export function ReactionChips({
  board,
  card,
  you,
  dispatch,
}: {
  board: Board;
  card: Card;
  you: You;
  dispatch: (op: Op) => void;
}) {
  const used = tally(board, card, you).filter((t) => t.count > 0);
  if (used.length === 0) {
    return null;
  }
  return (
    <ul className="mt-2 flex flex-wrap gap-1" aria-label="Reactions">
      {used.map((t) => (
        <li key={t.emoji}>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant={t.mine ? 'secondary' : 'outline'}
                  size="xs"
                  aria-pressed={t.mine}
                  aria-label={`${t.emoji} ${t.count}${t.mine ? ', you reacted' : ''}`}
                  className={cn(
                    'press tabular h-6 gap-1 px-1.5',
                    t.mine && 'border-primary/40',
                  )}
                  onClick={() =>
                    dispatch({
                      type: 'toggleReaction',
                      cardId: card.id,
                      emoji: t.emoji,
                    })
                  }
                />
              }
            >
              <span aria-hidden="true">{t.emoji}</span>
              <span key={t.count} className="count" aria-hidden="true">
                {t.count}
              </span>
            </TooltipTrigger>
            <TooltipContent>{t.names.join(', ')}</TooltipContent>
          </Tooltip>
        </li>
      ))}
    </ul>
  );
}

/** The smiley button that opens the fixed set. */
export function ReactionPicker({
  board,
  card,
  you,
  dispatch,
}: {
  board: Board;
  card: Card;
  you: You;
  dispatch: (op: Op) => void;
}) {
  const tallies = tally(board, card, you);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Add a reaction"
            className="press text-muted-foreground opacity-60 group-focus-within:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100 hover-none:opacity-100"
          />
        }
      >
        <SmileyIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>React</DropdownMenuLabel>
          {tallies.map((t) => (
            <DropdownMenuCheckboxItem
              key={t.emoji}
              checked={t.mine}
              onCheckedChange={() =>
                dispatch({
                  type: 'toggleReaction',
                  cardId: card.id,
                  emoji: t.emoji,
                })
              }
            >
              <span aria-hidden="true" className="text-base leading-none">
                {t.emoji}
              </span>
              <span className="flex-1">{t.label}</span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
