import { CrownSimpleIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import type { Board } from '#shared/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { initials } from '@/lib/identity';

/**
 * The owner's list of everyone on the board, overflow included, with a
 * confirmed "Remove" for each person but themselves.
 */
export function PeopleDialog({
  open,
  onOpenChange,
  board,
  youId,
  onRemove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  board: Board;
  youId: string;
  onRemove: (participantId: string) => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const sorted = [...board.participants].sort((a, b) => {
    if (a.id === youId) return -1;
    if (b.id === youId) return 1;
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setConfirming(null);
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>People on this board</DialogTitle>
          <DialogDescription>
            Remove someone to close their tabs and keep them out until the board
            resets. Their cards and comments stay; their votes and reactions go.
          </DialogDescription>
        </DialogHeader>
        <ul className="grid max-h-80 gap-1 overflow-y-auto">
          {sorted.map((p) => {
            const removable = p.id !== youId && p.id !== board.ownerId;
            return (
              <li
                key={p.id}
                className="flex items-center gap-3 rounded-md px-2 py-1.5"
              >
                <span
                  className="presence-avatar relative grid size-7 shrink-0 place-items-center rounded-full bg-muted text-[0.65rem] font-semibold"
                  data-online={p.online}
                  aria-hidden="true"
                >
                  {initials(p.name)}
                  {p.id === board.ownerId && (
                    <CrownSimpleIcon
                      weight="fill"
                      className="absolute -top-1.5 -right-1 size-3 text-foreground"
                    />
                  )}
                </span>
                {confirming === p.id ? (
                  <>
                    <span className="min-w-0 flex-1 text-sm">
                      Remove <strong className="font-medium">{p.name}</strong>?
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="press"
                      autoFocus
                      onClick={() => setConfirming(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="press"
                      onClick={() => {
                        setConfirming(null);
                        onRemove(p.id);
                      }}
                    >
                      Remove
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {p.name}
                      <span className="text-muted-foreground">
                        {p.id === youId ? ' (you)' : ''}
                        {p.id === board.ownerId ? ' · owner' : ''}
                        {p.online ? '' : ' · away'}
                      </span>
                    </span>
                    {removable && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="press"
                        aria-label={`Remove ${p.name}`}
                        onClick={() => setConfirming(p.id)}
                      >
                        Remove
                      </Button>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
