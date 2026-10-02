import {
  ArrowFatUpIcon,
  DotsSixVerticalIcon,
  DotsThreeIcon,
  MinusIcon,
  PencilSimpleIcon,
  StackSimpleIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { LIMITS } from '#shared/limits';
import type { Op, You } from '#shared/protocol';
import { votesUsed } from '#shared/reducer';
import type { Board, Card } from '#shared/types';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { useCardDrag } from '@/hooks/useCardDrag';
import { animateOut } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useMotion } from '@/providers/MotionProvider';

interface CardViewProps {
  card: Card;
  votes: number;
  board: Board;
  you: You;
  dispatch: (op: Op) => void;
  handleProps: ReturnType<typeof useCardDrag>['handleProps'];
  grouped?: boolean;
}

export function CardView({
  card,
  votes,
  board,
  you,
  dispatch,
  handleProps,
  grouped,
}: CardViewProps) {
  const { active } = useMotion();
  const ref = useRef<HTMLElement>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(card.text);

  const mine = card.authorId === you.id;
  const canEdit = mine || you.isOwner;
  const canArrange = canEdit || !board.settings.facilitatorOnly || you.isOwner;
  const blurred =
    board.phase === 'write' && board.settings.blurDuringWrite && !mine;
  const votingOpen = board.phase !== 'write';
  const myVotes =
    board.votes.find((v) => v.cardId === card.id && v.participantId === you.id)
      ?.count ?? 0;
  const votesLeft = board.settings.votesPerPerson - votesUsed(board, you.id);

  async function remove() {
    if (ref.current) {
      await animateOut(ref.current, active);
    }
    dispatch({ type: 'deleteCard', id: card.id });
  }

  function commitEdit() {
    const next = draft.trim();
    if (next && next !== card.text) {
      dispatch({ type: 'editCard', id: card.id, text: next });
    }
    setEditing(false);
  }

  return (
    <article
      ref={ref}
      data-card-id={card.id}
      data-group-id={card.groupId ?? ''}
      data-flip-id={grouped ? card.id : undefined}
      data-blurred={blurred}
      className={cn(
        'retro-card drop-target group relative rounded-lg border bg-card p-3 text-sm text-card-foreground shadow-xs',
        mine && 'border-foreground/25',
      )}
      aria-label={
        blurred ? 'A card, hidden until the Write phase ends' : undefined
      }
    >
      <div className="flex items-start gap-2">
        {canArrange && (
          <button
            type="button"
            aria-label="Drag to group or move"
            className="-ml-1.5 mt-0.5 shrink-0 rounded text-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring/50"
            {...handleProps(card.id, card.groupId)}
          >
            <DotsSixVerticalIcon weight="bold" className="size-4" />
          </button>
        )}

        {editing ? (
          <Textarea
            autoFocus
            aria-label="Edit card"
            value={draft}
            rows={3}
            maxLength={LIMITS.cardTextMax}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                commitEdit();
              }
              if (e.key === 'Escape') {
                setEditing(false);
              }
            }}
            className="min-h-0 flex-1 resize-none"
          />
        ) : (
          <p className="card-text min-w-0 flex-1 whitespace-pre-wrap break-words leading-relaxed">
            {card.text}
          </p>
        )}

        {canEdit && !editing && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Card actions"
                  className="press -mt-1 -mr-1.5 shrink-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100"
                />
              }
            >
              <DotsThreeIcon weight="bold" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {mine && (
                <DropdownMenuItem
                  onClick={() => {
                    setDraft(card.text);
                    setEditing(true);
                  }}
                >
                  <PencilSimpleIcon />
                  Edit
                </DropdownMenuItem>
              )}
              {card.groupId !== null && (
                <DropdownMenuItem
                  onClick={() => dispatch({ type: 'ungroupCard', id: card.id })}
                >
                  <StackSimpleIcon />
                  Ungroup
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={remove}>
                <TrashIcon />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {!canEdit && card.groupId !== null && canArrange && !editing && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Ungroup"
                  className="press -mt-1 -mr-1.5 shrink-0 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                  onClick={() => dispatch({ type: 'ungroupCard', id: card.id })}
                />
              }
            >
              <StackSimpleIcon />
            </TooltipTrigger>
            <TooltipContent>Ungroup</TooltipContent>
          </Tooltip>
        )}
      </div>

      <footer className="mt-2 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {card.anonymous ? 'Anonymous' : card.authorName}
          {mine && !card.anonymous && (
            <span className="opacity-70"> · you</span>
          )}
          {mine && card.anonymous && (
            <span className="opacity-70"> · yours</span>
          )}
        </span>

        {votingOpen && (
          <div className="flex items-center gap-0.5">
            {myVotes > 0 && (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Remove one of your votes"
                className="press text-muted-foreground"
                onClick={() => dispatch({ type: 'unvote', cardId: card.id })}
              >
                <MinusIcon />
              </Button>
            )}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant={myVotes > 0 ? 'secondary' : 'ghost'}
                    size="xs"
                    className="press tabular"
                    aria-label={`Vote. ${votes} ${votes === 1 ? 'vote' : 'votes'}${myVotes ? `, ${myVotes} yours` : ''}`}
                    disabled={votesLeft <= 0}
                    onClick={() => dispatch({ type: 'vote', cardId: card.id })}
                  />
                }
              >
                <ArrowFatUpIcon
                  weight={myVotes > 0 ? 'fill' : 'regular'}
                  data-icon="inline-start"
                />
                <span
                  key={votes}
                  className={cn('count', myVotes > 0 && 'vote-pop')}
                >
                  {votes}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {votesLeft > 0
                  ? `Vote (${votesLeft} left)`
                  : myVotes > 0
                    ? 'No votes left. Use − to take one back.'
                    : 'No votes left'}
              </TooltipContent>
            </Tooltip>
          </div>
        )}
      </footer>
    </article>
  );
}
