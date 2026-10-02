import { CrownSimpleIcon } from '@phosphor-icons/react';
import type { Participant } from '#shared/types';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { initials } from '@/lib/identity';

const SHOW = 6;

/** Who is here. Offline participants stay, dimmed; owner wears the crown. */
export function Presence({
  participants,
  youId,
  ownerId,
}: {
  participants: Participant[];
  youId: string;
  ownerId: string;
}) {
  const sorted = [...participants].sort((a, b) => {
    if (a.id === youId) return -1;
    if (b.id === youId) return 1;
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const shown = sorted.slice(0, SHOW);
  const extra = sorted.length - shown.length;
  const online = participants.filter((p) => p.online).length;

  return (
    <div className="flex items-center">
      <span className="sr-only">{online} here</span>
      <ul className="flex -space-x-1.5">
        {shown.map((p) => (
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
              </TooltipTrigger>
              <TooltipContent>
                {p.name}
                {p.id === youId ? ' (you)' : ''}
                {p.id === ownerId ? ' · owner' : ''}
                {p.online ? '' : ' · away'}
              </TooltipContent>
            </Tooltip>
          </li>
        ))}
        {extra > 0 && (
          <li className="presence-avatar grid size-7 place-items-center rounded-full border-2 border-background bg-muted text-[0.65rem] text-muted-foreground">
            +{extra}
          </li>
        )}
      </ul>
    </div>
  );
}
