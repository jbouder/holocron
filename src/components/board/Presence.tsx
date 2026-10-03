import {
  CheckIcon,
  CrownSimpleIcon,
  UsersThreeIcon,
} from '@phosphor-icons/react';
import { useState } from 'react';
import { votesLeft } from '#shared/reducer';
import type { Board } from '#shared/types';
import { PeopleDialog } from '@/components/board/PeopleDialog';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { initials } from '@/lib/identity';

const SHOW = 6;

/**
 * Who is here. Offline participants stay, dimmed; owner wears the crown.
 * In Write a check marks who said they are done; in Vote each avatar shows
 * how many votes that person has left (a count only, never where they went).
 * The owner gets a People button (`onRemove`) to take someone off the board.
 */
export function Presence({
  board,
  youId,
  onRemove,
}: {
  board: Board;
  youId: string;
  onRemove?: (participantId: string) => void;
}) {
  const [managing, setManaging] = useState(false);
  const { participants, ownerId, phase } = board;
  const sorted = [...participants].sort((a, b) => {
    if (a.id === youId) return -1;
    if (b.id === youId) return 1;
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const shown = sorted.slice(0, SHOW);
  const extra = sorted.length - shown.length;
  const here = participants.filter((p) => p.online);

  const isDone = (id: string) =>
    phase === 'write'
      ? board.done.includes(id)
      : phase === 'vote' && votesLeft(board, id) === 0;
  const doneCount = here.filter((p) => isDone(p.id)).length;
  const tracking = phase !== 'discuss';

  return (
    <div className="flex items-center gap-2">
      <span className="sr-only">{here.length} here</span>
      {/* Badges sit on the bottom-right corner, so avatars stop overlapping
          while they are showing. */}
      <ul className={tracking ? 'flex gap-1.5' : 'flex -space-x-1.5'}>
        {shown.map((p) => {
          const left = votesLeft(board, p.id);
          const done = isDone(p.id);
          return (
            <li key={p.id} className="presence-avatar" data-online={p.online}>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span className="relative grid size-7 place-items-center rounded-full border-2 border-background bg-muted text-[0.65rem] font-semibold text-foreground" />
                  }
                >
                  {initials(p.name)}
                  {p.id === ownerId && (
                    <CrownSimpleIcon
                      weight="fill"
                      className="absolute -top-1.5 -right-1 size-3 text-foreground"
                      aria-hidden="true"
                    />
                  )}
                  {phase === 'write' && done && (
                    <span
                      className="presence-badge absolute -right-1 -bottom-1 grid size-3.5 place-items-center rounded-full bg-primary text-primary-foreground ring-2 ring-background"
                      aria-hidden="true"
                    >
                      <CheckIcon weight="bold" className="size-2.5" />
                    </span>
                  )}
                  {phase === 'vote' && (
                    <span
                      className="absolute -right-1 -bottom-1 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-secondary px-0.5 text-[0.55rem] leading-none text-secondary-foreground tabular ring-2 ring-background data-[done=true]:bg-primary data-[done=true]:text-primary-foreground"
                      data-done={done}
                      aria-hidden="true"
                    >
                      <span key={left} className="count">
                        {left}
                      </span>
                    </span>
                  )}
                </TooltipTrigger>
                <TooltipContent>
                  {p.name}
                  {p.id === youId ? ' (you)' : ''}
                  {p.id === ownerId ? ' · owner' : ''}
                  {p.online ? '' : ' · away'}
                  {phase === 'write' && done ? ' · done' : ''}
                  {phase === 'vote'
                    ? ` · ${left} ${left === 1 ? 'vote' : 'votes'} left`
                    : ''}
                </TooltipContent>
              </Tooltip>
            </li>
          );
        })}
        {extra > 0 && (
          <li className="presence-avatar grid size-7 place-items-center rounded-full border-2 border-background bg-muted text-[0.65rem] text-muted-foreground">
            +{extra}
          </li>
        )}
      </ul>
      {onRemove && (
        <>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="People on this board"
                  className="press"
                  onClick={() => setManaging(true)}
                />
              }
            >
              <UsersThreeIcon />
            </TooltipTrigger>
            <TooltipContent>People</TooltipContent>
          </Tooltip>
          <PeopleDialog
            open={managing}
            onOpenChange={setManaging}
            board={board}
            youId={youId}
            onRemove={onRemove}
          />
        </>
      )}
      {tracking && here.length > 0 && (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                className="text-xs text-muted-foreground tabular"
                aria-live="polite"
              />
            }
          >
            {doneCount} of {here.length} done
          </TooltipTrigger>
          <TooltipContent>
            {phase === 'write'
              ? 'People here who marked themselves done writing'
              : 'People here who have spent all their votes'}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
