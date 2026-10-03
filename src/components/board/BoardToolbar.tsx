import {
  CheckCircleIcon,
  CheckSquareIcon,
  CircleIcon,
  DotsThreeIcon,
  DownloadSimpleIcon,
  GearSixIcon,
  HourglassIcon,
  ShareNetworkIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { LIMITS } from '#shared/limits';
import type { Op, You } from '#shared/protocol';
import { votesUsed } from '#shared/reducer';
import type { Board } from '#shared/types';
import { ActionItemsSheet } from '@/components/board/ActionItemsSheet';
import { DeleteBoardDialog } from '@/components/board/DeleteBoardDialog';
import { ExportDialog } from '@/components/board/ExportDialog';
import { PhaseStepper } from '@/components/board/PhaseStepper';
import { Presence } from '@/components/board/Presence';
import { SettingsDialog } from '@/components/board/SettingsDialog';
import { ShareDialog } from '@/components/board/ShareDialog';
import { TimerControl } from '@/components/board/TimerControl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { formatLocalTime, formatRemaining, useNow } from '@/hooks/useNow';

interface BoardToolbarProps {
  board: Board;
  you: You;
  ownerToken: string | null;
  dispatch: (op: Op) => void;
}

/** Title, code, expiry, who is here, the phase stepper, timer and actions. */
export function BoardToolbar({
  board,
  you,
  ownerToken,
  dispatch,
}: BoardToolbarProps) {
  const now = useNow(30_000);
  const [sharing, setSharing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [settings, setSettings] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actions, setActions] = useState(false);

  const canFacilitate = !board.settings.facilitatorOnly || you.isOwner;
  const remainingVotes =
    board.settings.votesPerPerson - votesUsed(board, you.id);
  const openActions = board.actionItems.filter((a) => !a.done).length;
  const imDone = board.done.includes(you.id);

  // Entering Discuss opens the action items once, on wide screens.
  const lastPhase = useRef(board.phase);
  useEffect(() => {
    if (board.phase === 'discuss' && lastPhase.current !== 'discuss') {
      if (window.matchMedia('(min-width: 1024px)').matches) {
        setActions(true);
      }
    }
    lastPhase.current = board.phase;
  }, [board.phase]);

  return (
    <div className="border-b">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-center gap-3">
            <EditableTitle
              title={board.title}
              editable={canFacilitate}
              onChange={(title) => dispatch({ type: 'renameBoard', title })}
            />
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="code-display press rounded-md border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
                    onClick={() => setSharing(true)}
                  />
                }
              >
                {board.code}
              </TooltipTrigger>
              <TooltipContent>Share this board</TooltipContent>
            </Tooltip>
          </div>

          <Tooltip>
            <TooltipTrigger
              render={
                <span className="text-xs text-muted-foreground tabular" />
              }
            >
              Expires in {formatRemaining(board.expiresAt - now)}
            </TooltipTrigger>
            <TooltipContent>
              Wiped at {formatLocalTime(board.expiresAt)} your time. Export
              before then.
            </TooltipContent>
          </Tooltip>

          <div className="ml-auto flex items-center gap-2">
            <Presence board={board} youId={you.id} />
            <Button
              variant="outline"
              size="sm"
              className="press"
              onClick={() => setSharing(true)}
            >
              <ShareNetworkIcon data-icon="inline-start" />
              Share
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Board actions"
                    className="press"
                  />
                }
              >
                <DotsThreeIcon weight="bold" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={() => setExporting(true)}>
                  <DownloadSimpleIcon />
                  Export as Markdown
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setActions(true)}>
                  <CheckSquareIcon />
                  Action items
                  {openActions > 0 && (
                    <span className="ml-auto text-muted-foreground">
                      {openActions}
                    </span>
                  )}
                </DropdownMenuItem>
                {you.isOwner && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setSettings(true)}>
                      <GearSixIcon />
                      Board settings
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => setDeleting(true)}
                    >
                      <TrashIcon />
                      Delete board
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <PhaseStepper
            phase={board.phase}
            enabled={canFacilitate}
            onChange={(phase) => dispatch({ type: 'setPhase', phase })}
          />
          <div className="ml-auto flex items-center gap-2">
            {board.phase === 'write' && (
              <Button
                variant={imDone ? 'secondary' : 'outline'}
                size="sm"
                className="press"
                aria-pressed={imDone}
                onClick={() => dispatch({ type: 'setDone', done: !imDone })}
              >
                {imDone ? (
                  <CheckCircleIcon weight="fill" data-icon="inline-start" />
                ) : (
                  <CircleIcon data-icon="inline-start" />
                )}
                {imDone ? 'Done' : "I'm done"}
              </Button>
            )}
            {board.phase !== 'write' && (
              <Badge
                variant={remainingVotes > 0 ? 'secondary' : 'outline'}
                className="tabular"
                aria-live="polite"
              >
                <span key={remainingVotes} className="count">
                  {remainingVotes}
                </span>
                &nbsp;{remainingVotes === 1 ? 'vote' : 'votes'} left
              </Badge>
            )}
            <Button
              variant={board.phase === 'discuss' ? 'secondary' : 'ghost'}
              size="sm"
              className="press"
              onClick={() => setActions(true)}
            >
              <CheckSquareIcon data-icon="inline-start" />
              Action items
              {openActions > 0 && (
                <span
                  key={openActions}
                  className="count ml-1 text-muted-foreground"
                >
                  {openActions}
                </span>
              )}
            </Button>
            <TimerControl
              timer={board.timer}
              enabled={canFacilitate}
              onSet={(durationMs) =>
                dispatch({
                  type: 'setTimer',
                  durationMs,
                  endsAt: Date.now() + durationMs,
                })
              }
              onClear={() => dispatch({ type: 'clearTimer' })}
            />
            {!canFacilitate && (
              <Tooltip>
                <TooltipTrigger
                  render={<span className="text-muted-foreground" />}
                >
                  <HourglassIcon
                    className="size-4"
                    aria-label="Only the owner can facilitate"
                  />
                </TooltipTrigger>
                <TooltipContent>
                  Only the owner can change phase and timer
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </div>

      <ShareDialog open={sharing} onOpenChange={setSharing} code={board.code} />
      <ExportDialog
        open={exporting}
        onOpenChange={setExporting}
        board={board}
      />
      <ActionItemsSheet
        open={actions}
        onOpenChange={setActions}
        board={board}
        dispatch={dispatch}
      />
      {you.isOwner && (
        <>
          <SettingsDialog
            open={settings}
            onOpenChange={setSettings}
            board={board}
            dispatch={dispatch}
          />
          <DeleteBoardDialog
            open={deleting}
            onOpenChange={setDeleting}
            code={board.code}
            title={board.title}
            ownerToken={ownerToken}
          />
        </>
      )}
    </div>
  );
}

function EditableTitle({
  title,
  editable,
  onChange,
}: {
  title: string;
  editable: boolean;
  onChange: (title: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);

  if (!editing) {
    return (
      <h1 className="min-w-0 truncate font-heading text-xl font-semibold tracking-tight">
        {editable ? (
          <button
            type="button"
            className="truncate rounded-md text-left outline-ring/50 hover:underline hover:underline-offset-4 focus-visible:outline-2"
            onClick={() => {
              setDraft(title);
              setEditing(true);
            }}
            title="Rename board"
          >
            {title}
          </button>
        ) : (
          title
        )}
      </h1>
    );
  }

  function commit() {
    const next = draft.trim();
    if (next && next !== title) {
      onChange(next);
    }
    setEditing(false);
  }

  return (
    <input
      // biome-ignore lint/a11y/noAutofocus: the user just asked to edit this
      autoFocus
      aria-label="Board title"
      className="h-8 min-w-0 rounded-md border bg-background px-2 font-heading text-xl font-semibold tracking-tight outline-ring/50 focus-visible:outline-2"
      maxLength={LIMITS.titleMax}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit();
        } else if (e.key === 'Escape') {
          setEditing(false);
        }
      }}
    />
  );
}
