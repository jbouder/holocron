import { DotsThreeIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { useMemo, useRef, useState } from 'react';
import { LIMITS } from '#shared/limits';
import type { Op, You } from '#shared/protocol';
import { cardsInColumn, votesFor } from '#shared/reducer';
import type { Board, Card } from '#shared/types';
import { CardView } from '@/components/board/CardView';
import { Composer } from '@/components/board/Composer';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCardDrag } from '@/hooks/useCardDrag';
import { useFlip } from '@/hooks/useFlip';
import { useMotion } from '@/providers/MotionProvider';

interface ColumnsProps {
  board: Board;
  you: You;
  dispatch: (op: Op) => void;
}

/** A stack is one loose card or one group of cards, in column order. */
export interface Stack {
  key: string;
  groupId: string | null;
  cards: Card[];
  votes: number;
}

export function stacksFor(board: Board, columnId: string): Stack[] {
  const stacks: Stack[] = [];
  const byGroup = new Map<string, Stack>();
  for (const card of cardsInColumn(board, columnId)) {
    const votes = votesFor(board, card.id);
    if (card.groupId === null) {
      stacks.push({ key: card.id, groupId: null, cards: [card], votes });
      continue;
    }
    let stack = byGroup.get(card.groupId);
    if (!stack) {
      stack = {
        key: `g:${card.groupId}`,
        groupId: card.groupId,
        cards: [],
        votes: 0,
      };
      byGroup.set(card.groupId, stack);
      stacks.push(stack);
    }
    stack.cards.push(card);
    stack.votes += votes;
  }
  if (board.phase === 'discuss') {
    // Stable: ties keep column order.
    return stacks
      .map((s, i) => ({ s, i }))
      .sort((a, b) => b.s.votes - a.s.votes || a.i - b.i)
      .map(({ s }) => s);
  }
  return stacks;
}

export function Columns({ board, you, dispatch }: ColumnsProps) {
  const { active } = useMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  useFlip(containerRef, active);

  const canFacilitate = !board.settings.facilitatorOnly || you.isOwner;

  const { handleProps } = useCardDrag(
    {
      onGroup: (id, targetId) =>
        dispatch({
          type: 'groupCards',
          id,
          targetId,
          groupId: crypto.randomUUID(),
        }),
      onMove: (id, columnId, position) =>
        dispatch({ type: 'moveCard', id, columnId, position }),
    },
    true,
  );

  const columns = useMemo(
    () => [...board.columns].sort((a, b) => a.position - b.position),
    [board.columns],
  );

  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-4 sm:px-6">
      <div ref={containerRef} className="board-columns">
        {columns.map((column, i) => (
          <ColumnView
            key={column.id}
            index={i}
            columnId={column.id}
            title={column.title}
            board={board}
            you={you}
            canFacilitate={canFacilitate}
            canDelete={columns.length > 1}
            dispatch={dispatch}
            handleProps={handleProps}
          />
        ))}
        {canFacilitate && columns.length < LIMITS.columnsMax && (
          <div
            className="stagger-in pt-1"
            style={{ '--i': columns.length } as React.CSSProperties}
          >
            <Button
              variant="ghost"
              className="press w-full justify-start text-muted-foreground"
              onClick={() =>
                dispatch({
                  type: 'addColumn',
                  id: crypto.randomUUID(),
                  title: `Column ${columns.length + 1}`,
                })
              }
            >
              <PlusIcon data-icon="inline-start" />
              Add column
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

interface ColumnViewProps {
  index: number;
  columnId: string;
  title: string;
  board: Board;
  you: You;
  canFacilitate: boolean;
  canDelete: boolean;
  dispatch: (op: Op) => void;
  handleProps: ReturnType<typeof useCardDrag>['handleProps'];
}

function ColumnView({
  index,
  columnId,
  title,
  board,
  you,
  canFacilitate,
  canDelete,
  dispatch,
  handleProps,
}: ColumnViewProps) {
  const stacks = useMemo(() => stacksFor(board, columnId), [board, columnId]);
  const count = stacks.reduce((n, s) => n + s.cards.length, 0);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(title);

  function commitRename() {
    const next = draft.trim();
    if (next && next !== title) {
      dispatch({ type: 'renameColumn', id: columnId, title: next });
    }
    setRenaming(false);
  }

  return (
    <section
      className="stagger-in flex min-h-[50dvh] flex-col rounded-lg border bg-card/40"
      style={{ '--i': index } as React.CSSProperties}
      aria-label={title}
    >
      <header className="flex items-center gap-2 px-3 pt-3 pb-2">
        {renaming ? (
          <input
            // biome-ignore lint/a11y/noAutofocus: the user just asked to rename
            autoFocus
            aria-label="Column title"
            className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm font-semibold outline-ring/50 focus-visible:outline-2"
            maxLength={LIMITS.columnTitleMax}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') setRenaming(false);
            }}
          />
        ) : (
          <h2 className="min-w-0 flex-1 truncate font-heading text-sm font-semibold">
            {title}
          </h2>
        )}
        <span className="text-xs text-muted-foreground tabular">
          <span key={count} className="count">
            {count}
          </span>
          <span className="sr-only"> cards</span>
        </span>
        {canFacilitate && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="press"
                  aria-label="Column actions"
                />
              }
            >
              <DotsThreeIcon weight="bold" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => {
                  setDraft(title);
                  setRenaming(true);
                }}
              >
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                disabled={!canDelete}
                onClick={() => {
                  if (
                    count === 0 ||
                    window.confirm(`Delete "${title}" and its ${count} cards?`)
                  ) {
                    dispatch({ type: 'deleteColumn', id: columnId });
                  }
                }}
              >
                <TrashIcon />
                Delete column
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      <div className="px-3 pb-3">
        <Composer
          columnId={columnId}
          anonymousAllowed={board.settings.anonymousAllowed}
          dispatch={dispatch}
        />
      </div>

      <div
        className="drop-target flex flex-1 flex-col gap-2 rounded-b-lg px-3 pb-3"
        data-column-id={columnId}
      >
        {stacks.map((stack, i) =>
          stack.groupId === null ? (
            <div
              key={stack.key}
              data-stack
              data-card-count={1}
              data-flip-id={stack.key}
              style={{ '--i': Math.min(i, 8) } as React.CSSProperties}
            >
              <CardView
                card={stack.cards[0]}
                votes={stack.votes}
                board={board}
                you={you}
                dispatch={dispatch}
                handleProps={handleProps}
              />
            </div>
          ) : (
            <div
              key={stack.key}
              data-stack
              data-card-count={stack.cards.length}
              data-flip-id={stack.key}
              className="retro-card drop-target rounded-lg border border-dashed border-foreground/30 bg-muted/30 p-1.5"
              style={{ '--i': Math.min(i, 8) } as React.CSSProperties}
            >
              <div className="flex items-center justify-between px-1.5 pt-0.5 pb-1.5 text-xs text-muted-foreground">
                <span>Group · {stack.cards.length} cards</span>
                {board.phase !== 'write' && (
                  <span className="tabular">
                    <span key={stack.votes} className="count">
                      {stack.votes}
                    </span>{' '}
                    {stack.votes === 1 ? 'vote' : 'votes'}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                {stack.cards.map((card) => (
                  <CardView
                    key={card.id}
                    card={card}
                    votes={votesFor(board, card.id)}
                    board={board}
                    you={you}
                    dispatch={dispatch}
                    handleProps={handleProps}
                    grouped
                  />
                ))}
              </div>
            </div>
          ),
        )}
        {stacks.length === 0 && (
          <p className="mt-6 text-center text-xs text-muted-foreground">
            {board.phase === 'write'
              ? 'Nothing here yet. Add the first card.'
              : 'No cards.'}
          </p>
        )}
      </div>
    </section>
  );
}
