import {
  LinkSimpleIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from '@phosphor-icons/react';
import { type FormEvent, useRef, useState } from 'react';
import { LIMITS } from '#shared/limits';
import type { Op, You } from '#shared/protocol';
import { isCardHidden } from '#shared/reducer';
import type { Board } from '#shared/types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { useMotion } from '@/providers/MotionProvider';
import { revealCard } from './action-link';

/** Whether the sheet is open, and the card a new item will link to. */
export interface ActionsSheetState {
  open: boolean;
  cardId: string | null;
}

/** Decisions. Anyone can add, tick and remove; the list exports with the board. */
export function ActionItemsSheet({
  state,
  onStateChange,
  board,
  you,
  dispatch,
}: {
  state: ActionsSheetState;
  onStateChange: (next: ActionsSheetState) => void;
  board: Board;
  you: You;
  dispatch: (op: Op) => void;
}) {
  const { active } = useMotion();
  const textRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [owner, setOwner] = useState('');
  const names = Array.from(
    new Set(board.participants.map((p) => p.name)),
  ).sort();

  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    dispatch({
      type: 'addActionItem',
      id: crypto.randomUUID(),
      text: trimmed,
      owner: owner.trim(),
      cardId: linkedCard ? linkedCard.id : null,
    });
    setText('');
    if (state.cardId !== null) {
      onStateChange({ ...state, cardId: null });
    }
  }

  /** What a linked card shows as: its text, unless it is still blurred for you. */
  function cardQuote(cardId: string): string | null {
    const card = board.cards.find((c) => c.id === cardId);
    if (!card) {
      return null;
    }
    return isCardHidden(board, card, you) ? 'A hidden card' : card.text;
  }

  function jumpToCard(cardId: string) {
    // The sheet is modal; close it first so the card is reachable.
    onStateChange({ open: false, cardId: null });
    window.setTimeout(() => revealCard(cardId, active), 0);
  }

  // The card may have been deleted while the sheet was open.
  const linkedCard =
    state.cardId === null
      ? undefined
      : board.cards.find((c) => c.id === state.cardId);

  const openItems = board.actionItems.filter((a) => !a.done);
  const doneItems = board.actionItems.filter((a) => a.done);

  return (
    <Sheet
      open={state.open}
      onOpenChange={(open) => onStateChange({ open, cardId: null })}
    >
      <SheetContent
        side="right"
        // Opened from a card: the next thing to do is type the action.
        initialFocus={state.cardId !== null ? textRef : undefined}
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        <SheetHeader className="border-b p-4">
          <SheetTitle>Action items</SheetTitle>
          <SheetDescription>
            What the team will do next, and who owns it. Included in the export.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={submit} className="grid gap-3 border-b p-4">
          {linkedCard && (
            <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-2.5 py-2 text-xs">
              <LinkSimpleIcon className="mt-0.5 shrink-0 text-muted-foreground" />
              <p className="line-clamp-2 min-w-0 flex-1">
                <span className="text-muted-foreground">From the card </span>
                {linkedCard.text}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Don't link to this card"
                className="press -my-1 -mr-1"
                onClick={() => onStateChange({ ...state, cardId: null })}
              >
                <XIcon />
              </Button>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="action-text">Action</Label>
            <Input
              id="action-text"
              ref={textRef}
              value={text}
              maxLength={LIMITS.actionTextMax}
              onChange={(e) => setText(e.target.value)}
              placeholder="Fix the flaky deploy step"
            />
          </div>
          <div className="flex items-end gap-2">
            <div className="grid flex-1 gap-1.5">
              <Label htmlFor="action-owner">
                Owner <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="action-owner"
                list="participant-names"
                value={owner}
                maxLength={LIMITS.nameMax}
                onChange={(e) => setOwner(e.target.value)}
                placeholder="Who"
              />
              <datalist id="participant-names">
                {names.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </div>
            <Button type="submit" disabled={!text.trim()} className="press">
              <PlusIcon data-icon="inline-start" />
              Add
            </Button>
          </div>
        </form>

        <div className="scrollbar-thin flex-1 overflow-y-auto p-2">
          {board.actionItems.length === 0 ? (
            <p className="p-4 text-center text-sm text-muted-foreground">
              Nothing yet. Decisions go here as you discuss.
            </p>
          ) : (
            <ul className="grid gap-1">
              {[...openItems, ...doneItems].map((item, i) => (
                <li
                  key={item.id}
                  className={cn(
                    'stagger-in group flex items-start gap-3 rounded-md px-2 py-2 hover:bg-muted/60',
                    item.done && 'opacity-60',
                  )}
                  style={{ '--i': Math.min(i, 8) } as React.CSSProperties}
                >
                  <Checkbox
                    id={`ai-${item.id}`}
                    checked={item.done}
                    onCheckedChange={() =>
                      dispatch({ type: 'toggleActionItem', id: item.id })
                    }
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <label
                      htmlFor={`ai-${item.id}`}
                      className="block cursor-pointer text-sm"
                    >
                      <span className={cn(item.done && 'line-through')}>
                        {item.text}
                      </span>
                      {item.owner && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {item.owner}
                        </span>
                      )}
                    </label>
                    {item.cardId !== null && (
                      <LinkedCard
                        cardId={item.cardId}
                        quote={cardQuote(item.cardId)}
                        onJump={jumpToCard}
                      />
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Remove action item"
                    className="press opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                    onClick={() =>
                      dispatch({ type: 'deleteActionItem', id: item.id })
                    }
                  >
                    <TrashIcon />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** The card an action item came from; clicking it shows the card. */
function LinkedCard({
  cardId,
  quote,
  onJump,
}: {
  cardId: string;
  quote: string | null;
  onJump: (cardId: string) => void;
}) {
  if (quote === null) {
    return null;
  }
  return (
    <button
      type="button"
      onClick={() => onJump(cardId)}
      className="mt-1 flex max-w-full items-center gap-1.5 rounded-sm text-left text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      aria-label={`Show the card: ${quote}`}
    >
      <LinkSimpleIcon className="shrink-0" />
      <span className="truncate">{quote}</span>
    </button>
  );
}
