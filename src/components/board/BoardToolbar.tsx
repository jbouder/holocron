import {
  CheckCircleIcon,
  CheckSquareIcon,
  CircleIcon,
  DotsThreeIcon,
  DownloadSimpleIcon,
  GearSixIcon,
  HourglassIcon,
  KeyIcon,
  ShareNetworkIcon,
  SparkleIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { useState } from 'react';
import { LIMITS } from '#shared/limits';
import type { Op, You } from '#shared/protocol';
import { votesUsed } from '#shared/reducer';
import type { Board } from '#shared/types';
import {
  ActionItemsSheet,
  type ActionsSheetState,
} from '@/components/board/ActionItemsSheet';
import { AnalysisPanel } from '@/components/board/AnalysisPanel';
import { DeleteBoardDialog } from '@/components/board/DeleteBoardDialog';
import { ExportDialog } from '@/components/board/ExportDialog';
import {
  ClaimOwnershipDialog,
  HandoffDialog,
} from '@/components/board/HandoffDialog';
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
  /** A handoff code was redeemed here; this browser holds the new token. */
  onClaimed: (ownerToken: string) => void;
  dispatch: (op: Op) => void;
  actions: ActionsSheetState;
  onActionsChange: (next: ActionsSheetState) => void;
}

/** Title, code, expiry, who is here, the phase stepper, timer and actions. */
export function BoardToolbar({
  board,
  you,
  ownerToken,
  onClaimed,
  dispatch,
  actions,
  onActionsChange,
}: BoardToolbarProps) {
  const now = useNow(30_000);
  const [sharing, setSharing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [settings, setSettings] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [handingOff, setHandingOff] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const openActionsSheet = () => onActionsChange({ open: true, cardId: null });

  const canFacilitate = !board.settings.facilitatorOnly || you.isOwner;
  const remainingVotes =
    board.settings.votesPerPerson - votesUsed(board, you.id);
  const openActions = board.actionItems.filter((a) => !a.done).length;
  const imDone = board.done.includes(you.id);

  return (
    <div className="border-b">
      <div className="flex w-full flex-col gap-3 px-4 py-4 sm:px-6">
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
                  Export
                </DropdownMenuItem>
                <DropdownMenuItem onClick={openActionsSheet}>
                  <CheckSquareIcon />
                  Action items
                  {openActions > 0 && (
                    <span className="ml-auto text-muted-foreground">
                      {openActions}
                    </span>
                  )}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {you.isOwner ? (
                  <>
                    <DropdownMenuItem onClick={() => setSettings(true)}>
                      <GearSixIcon />
                      Board settings
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setHandingOff(true)}>
                      <KeyIcon />
                      Hand off ownership
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => setDeleting(true)}
                    >
                      <TrashIcon />
                      Delete board
                    </DropdownMenuItem>
                  </>
                ) : (
                  <DropdownMenuItem onClick={() => setClaiming(true)}>
                    <KeyIcon />
                    Claim ownership
                  </DropdownMenuItem>
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
              onClick={openActionsSheet}
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
            {you.isOwner &&
              (board.phase === 'discuss' ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="press"
                  onClick={() => setAnalysing(true)}
                >
                  <SparkleIcon data-icon="inline-start" />
                  Analysis
                </Button>
              ) : (
                <Tooltip>
                  <TooltipTrigger render={<span className="inline-flex" />}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="press"
                      disabled
                      aria-label="Analysis, available in Discuss"
                    >
                      <SparkleIcon data-icon="inline-start" />
                      Analysis
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Available in Discuss</TooltipContent>
                </Tooltip>
              ))}
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
        state={actions}
        onStateChange={onActionsChange}
        board={board}
        you={you}
        dispatch={dispatch}
      />
      {you.isOwner ? (
        <>
          <AnalysisPanel
            open={analysing}
            onOpenChange={setAnalysing}
            board={board}
            you={you}
            dispatch={dispatch}
          />
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
          <HandoffDialog
            open={handingOff}
            onOpenChange={setHandingOff}
            code={board.code}
            ownerToken={ownerToken}
          />
        </>
      ) : (
        <ClaimOwnershipDialog
          open={claiming}
          onOpenChange={setClaiming}
          code={board.code}
          onClaimed={onClaimed}
        />
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
      className="h-8 min-w-0 rounded-none border bg-background px-2 font-heading text-xl font-semibold tracking-tight outline-ring/50 focus-visible:outline-2"
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
