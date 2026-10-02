import { PlusIcon, TrashIcon } from '@phosphor-icons/react';
import { type FormEvent, useState } from 'react';
import { LIMITS } from '#shared/limits';
import type { Op } from '#shared/protocol';
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

/** Decisions. Anyone can add, tick and remove; the list exports with the board. */
export function ActionItemsSheet({
  open,
  onOpenChange,
  board,
  dispatch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  board: Board;
  dispatch: (op: Op) => void;
}) {
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
    });
    setText('');
  }

  const openItems = board.actionItems.filter((a) => !a.done);
  const doneItems = board.actionItems.filter((a) => a.done);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        <SheetHeader className="border-b p-4">
          <SheetTitle>Action items</SheetTitle>
          <SheetDescription>
            What the team will do next, and who owns it. Included in the export.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={submit} className="grid gap-3 border-b p-4">
          <div className="grid gap-1.5">
            <Label htmlFor="action-text">Action</Label>
            <Input
              id="action-text"
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
                  <label
                    htmlFor={`ai-${item.id}`}
                    className="min-w-0 flex-1 cursor-pointer text-sm"
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
