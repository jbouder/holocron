import {
  ArrowFatUpIcon,
  CheckSquareIcon,
  DotsSixVerticalIcon,
  DotsThreeIcon,
  MinusIcon,
  PencilSimpleIcon,
  StackSimpleIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import {
  type PointerEvent as ReactPointerEvent,
  useId,
  useRef,
  useState,
} from 'react';
import { LIMITS } from '#shared/limits';
import type { Op, You } from '#shared/protocol';
import {
  isCardAuthor,
  isCardHidden,
  isCardSealed,
  votesUsed,
} from '#shared/reducer';
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
import { useAddActionForCard } from './action-link';
import { CommentThread, CommentToggle, commentsOn } from './CardComments';
import { ReactionChips, ReactionPicker } from './CardReactions';

const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP = 24;

interface CardViewProps {
  card: Card;
  votes: number;
  board: Board;
  you: You;
  dispatch: (op: Op) => void;
  handleProps: ReturnType<typeof useCardDrag>['handleProps'];
  grouped?: boolean;
}

/**
 * What a blurred card shows: the server never sends its text (see
 * `redactHidden`), so something has to sit under the blur.
 */
const HIDDEN_TEXT = 'Hidden until the Write phase ends';

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

  // Anonymous cards carry no author id; `you` lists the ones that are yours.
  const mine = isCardAuthor(card, you);
  // The menu: delete (author or owner) and ungroup. Editing is author-only.
  const canEdit = mine || you.isOwner;
  const canArrange = canEdit || !board.settings.facilitatorOnly || you.isOwner;
  const blurred = isCardHidden(board, card, you);
  // Reactions, comments and action item links, which would name whoever
  // added them: open to anyone who can read the card, except on an anonymous
  // card only its author can read yet (that would unmask them).
  const canRespond = !blurred && !isCardSealed(board, card);
  const canAddAction = canRespond;
  const addActionFor = useAddActionForCard();
  const [threadOpen, setThreadOpen] = useState(false);
  const threadId = useId();
  const commentCount = commentsOn(board, card).length;
  const votingOpen = board.phase !== 'write';
  const myVotes =
    board.votes.find((v) => v.cardId === card.id && v.participantId === you.id)
      ?.count ?? 0;
  const votesLeft = board.settings.votesPerPerson - votesUsed(board, you.id);
  const canInlineEdit = mine && !blurred;
  const lastTap = useRef({ time: 0, x: 0, y: 0 });

  function startEdit() {
    if (ref.current?.dataset.dragging) {
      return;
    }
    setDraft(card.text);
    setEditing(true);
  }

  /** Touch has no reliable dblclick, so detect a double-tap by hand. */
  function onTextPointerUp(event: ReactPointerEvent) {
    if (event.pointerType !== 'touch') {
      return;
    }
    const prev = lastTap.current;
    const now = event.timeStamp;
    const near =
      Math.hypot(event.clientX - prev.x, event.clientY - prev.y) <
      DOUBLE_TAP_SLOP;
    if (now - prev.time < DOUBLE_TAP_MS && near) {
      lastTap.current = { time: 0, x: 0, y: 0 };
      event.preventDefault();
      startEdit();
    } else {
      lastTap.current = { time: now, x: event.clientX, y: event.clientY };
    }
  }

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
      // Dropping a card here regroups this one too; not offered when you
      // cannot arrange it (useCardDrag skips it).
      data-no-group={canArrange ? undefined : ''}
      className={cn(
        'retro-card drop-target group relative rounded-lg border bg-card p-3 text-sm text-card-foreground shadow-xs',
        // The drag handle lives in the left gutter, so widen it rather than
        // push the title out of line with the author row.
        canArrange && 'pl-7',
        mine && 'border-foreground/25',
      )}
      aria-label={
        blurred ? 'A card, hidden until the Write phase ends' : undefined
      }
    >
      {canArrange && (
        <button
          type="button"
          aria-label="Drag to group or move"
          className="absolute inset-y-0 left-0 flex w-7 items-start justify-center rounded-l-lg pt-3.5 text-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover-none:opacity-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring/50"
          {...handleProps(card.id, card.groupId)}
        >
          <DotsSixVerticalIcon weight="bold" className="size-4" />
        </button>
      )}

      <div className="flex items-start gap-2">
        {editing ? (
          <Textarea
            autoFocus
            aria-label="Edit card"
            value={draft}
            rows={3}
            maxLength={LIMITS.cardTextMax}
            onFocus={(e) => {
              const end = e.currentTarget.value.length;
              e.currentTarget.setSelectionRange(end, end);
            }}
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
          <p
            className={cn(
              'card-text min-w-0 flex-1 whitespace-pre-wrap break-words leading-relaxed',
              canInlineEdit && 'touch-manipulation',
            )}
            onMouseDown={
              canInlineEdit
                ? (e) => {
                    // Stop the second click selecting a word before the editor opens.
                    if (e.detail > 1) {
                      e.preventDefault();
                    }
                  }
                : undefined
            }
            onDoubleClick={canInlineEdit ? startEdit : undefined}
            onPointerUp={canInlineEdit ? onTextPointerUp : undefined}
          >
            {blurred ? HIDDEN_TEXT : card.text}
          </p>
        )}

        {(canEdit || canAddAction) && !editing && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Card actions"
                  className="press -mt-1 -mr-1.5 shrink-0 opacity-50 group-focus-within:opacity-100 group-hover:opacity-100 aria-expanded:opacity-100 hover-none:opacity-100"
                />
              }
            >
              <DotsThreeIcon weight="bold" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {mine && (
                <DropdownMenuItem onClick={startEdit}>
                  <PencilSimpleIcon />
                  Edit
                </DropdownMenuItem>
              )}
              {canAddAction && (
                <DropdownMenuItem onClick={() => addActionFor(card.id)}>
                  <CheckSquareIcon />
                  Add action item
                </DropdownMenuItem>
              )}
              {card.groupId !== null && canArrange && (
                <DropdownMenuItem
                  onClick={() => dispatch({ type: 'ungroupCard', id: card.id })}
                >
                  <StackSimpleIcon />
                  Ungroup
                </DropdownMenuItem>
              )}
              {canEdit && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={remove}>
                    <TrashIcon />
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {!canEdit &&
          !canAddAction &&
          card.groupId !== null &&
          canArrange &&
          !editing && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Ungroup"
                    className="press -mt-1 -mr-1.5 shrink-0 opacity-50 group-focus-within:opacity-100 group-hover:opacity-100 hover-none:opacity-100"
                    onClick={() =>
                      dispatch({ type: 'ungroupCard', id: card.id })
                    }
                  />
                }
              >
                <StackSimpleIcon />
              </TooltipTrigger>
              <TooltipContent>Ungroup</TooltipContent>
            </Tooltip>
          )}
      </div>

      {canRespond && (
        <ReactionChips
          board={board}
          card={card}
          you={you}
          dispatch={dispatch}
        />
      )}

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

        <div className="flex shrink-0 items-center gap-0.5">
          {canRespond && (
            <>
              <ReactionPicker
                board={board}
                card={card}
                you={you}
                dispatch={dispatch}
              />
              <CommentToggle
                count={commentCount}
                open={threadOpen}
                controls={threadId}
                onToggle={() => setThreadOpen((o) => !o)}
              />
            </>
          )}
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
                      onClick={() =>
                        dispatch({ type: 'vote', cardId: card.id })
                      }
                    />
                  }
                >
                  <ArrowFatUpIcon
                    weight={myVotes > 0 ? 'fill' : 'regular'}
                    data-icon="inline-start"
                  />
                  <span className="count">{votes}</span>
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
        </div>
      </footer>

      {threadOpen && canRespond && (
        <CommentThread
          id={threadId}
          board={board}
          card={card}
          you={you}
          dispatch={dispatch}
        />
      )}
    </article>
  );
}
