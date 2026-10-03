import {
  ChatCircleIcon,
  PaperPlaneRightIcon,
  PencilSimpleIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { type FormEvent, useId, useState } from 'react';
import { LIMITS } from '#shared/limits';
import type { Op, You } from '#shared/protocol';
import { isCommentAuthor } from '#shared/reducer';
import type { Board, Card, Comment } from '#shared/types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export function commentsOn(board: Board, card: Card): Comment[] {
  return board.comments
    .filter((c) => c.cardId === card.id)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** The footer button that opens a card's thread. */
export function CommentToggle({
  count,
  open,
  controls,
  onToggle,
}: {
  count: number;
  open: boolean;
  controls: string;
  onToggle: () => void;
}) {
  return (
    <Button
      variant={open ? 'secondary' : 'ghost'}
      size={count > 0 ? 'xs' : 'icon-xs'}
      aria-expanded={open}
      aria-controls={controls}
      aria-label={count > 0 ? `Comments, ${count}` : 'Add a comment'}
      className={
        count > 0 || open
          ? 'press tabular text-muted-foreground'
          : 'press text-muted-foreground opacity-60 group-focus-within:opacity-100 group-hover:opacity-100 hover-none:opacity-100'
      }
      onClick={onToggle}
    >
      <ChatCircleIcon
        weight={count > 0 ? 'fill' : 'regular'}
        data-icon={count > 0 ? 'inline-start' : undefined}
      />
      {count > 0 && <span className="count">{count}</span>}
    </Button>
  );
}

/** Comments under a card, oldest first, with a box to add one. */
export function CommentThread({
  id,
  board,
  card,
  you,
  dispatch,
}: {
  id: string;
  board: Board;
  card: Card;
  you: You;
  dispatch: (op: Op) => void;
}) {
  const comments = commentsOn(board, card);
  const full = comments.length >= LIMITS.commentsPerCardMax;
  return (
    <section
      id={id}
      aria-label="Comments"
      className="stagger-in mt-2 grid gap-2 border-t pt-2"
    >
      {comments.length > 0 && (
        <ul className="grid gap-2">
          {comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              you={you}
              dispatch={dispatch}
            />
          ))}
        </ul>
      )}
      {full ? (
        <p className="text-xs text-muted-foreground">
          This card has the most comments it can hold.
        </p>
      ) : (
        <CommentComposer
          cardId={card.id}
          anonymousAllowed={board.settings.anonymousAllowed}
          dispatch={dispatch}
        />
      )}
    </section>
  );
}

function CommentItem({
  comment,
  you,
  dispatch,
}: {
  comment: Comment;
  you: You;
  dispatch: (op: Op) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.text);
  // Anonymous comments carry no author id; `you` lists the ones that are yours.
  const mine = isCommentAuthor(comment, you);
  const canDelete = mine || you.isOwner;

  function commit() {
    const next = draft.trim();
    if (next && next !== comment.text) {
      dispatch({ type: 'editComment', id: comment.id, text: next });
    }
    setEditing(false);
  }

  return (
    <li className="group/comment grid gap-0.5 text-xs">
      <div className="flex items-center gap-1 text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">
          {comment.anonymous ? 'Anonymous' : comment.authorName}
          {mine && <span>{comment.anonymous ? ' · yours' : ' · you'}</span>}
          {comment.editedAt !== null && <span> · edited</span>}
        </span>
        {mine && !editing && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Edit comment"
            className="press size-5 opacity-60 group-focus-within/comment:opacity-100 group-hover/comment:opacity-100 hover-none:opacity-100"
            onClick={() => {
              setDraft(comment.text);
              setEditing(true);
            }}
          >
            <PencilSimpleIcon />
          </Button>
        )}
        {canDelete && !editing && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Delete comment"
            className="press size-5 opacity-60 group-focus-within/comment:opacity-100 group-hover/comment:opacity-100 hover-none:opacity-100"
            onClick={() => dispatch({ type: 'deleteComment', id: comment.id })}
          >
            <TrashIcon />
          </Button>
        )}
      </div>
      {editing ? (
        <Textarea
          aria-label="Edit comment"
          autoFocus
          value={draft}
          maxLength={LIMITS.commentTextMax}
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              commit();
            }
            if (e.key === 'Escape') {
              setEditing(false);
            }
          }}
          className="min-h-0 resize-none text-xs"
        />
      ) : (
        <p className="whitespace-pre-wrap break-words leading-relaxed text-card-foreground">
          {comment.text}
        </p>
      )}
    </li>
  );
}

/** Enter posts, Shift+Enter breaks a line, like the card composer. */
function CommentComposer({
  cardId,
  anonymousAllowed,
  dispatch,
}: {
  cardId: string;
  anonymousAllowed: boolean;
  dispatch: (op: Op) => void;
}) {
  const [text, setText] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const id = useId();
  const trimmed = text.trim();

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!trimmed) {
      return;
    }
    dispatch({
      type: 'addComment',
      id: crypto.randomUUID(),
      cardId,
      text: trimmed,
      anonymous: anonymous && anonymousAllowed,
    });
    setText('');
  }

  return (
    <form onSubmit={submit} className="grid gap-1.5">
      <Textarea
        aria-label="New comment"
        value={text}
        rows={text ? 2 : 1}
        maxLength={LIMITS.commentTextMax}
        placeholder="Add a comment…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        className="min-h-0 resize-none text-xs"
      />
      {text.length > 0 && (
        <div className="flex items-center justify-between gap-2">
          {anonymousAllowed ? (
            <div className="flex items-center gap-2">
              <Checkbox
                id={`${id}-anon`}
                checked={anonymous}
                onCheckedChange={(v) => setAnonymous(Boolean(v))}
              />
              <Label
                htmlFor={`${id}-anon`}
                className="text-xs font-normal text-muted-foreground"
              >
                Anonymously
              </Label>
            </div>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <span className="text-[0.65rem] text-muted-foreground tabular">
              {text.length}/{LIMITS.commentTextMax}
            </span>
            <Button
              type="submit"
              size="xs"
              disabled={!trimmed}
              className="press"
            >
              <PaperPlaneRightIcon data-icon="inline-start" />
              Comment
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
