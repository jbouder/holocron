import {
  ArrowClockwiseIcon,
  CheckSquareIcon,
  DownloadSimpleIcon,
  LinkSimpleIcon,
  ListBulletsIcon,
  PlusIcon,
  SparkleIcon,
  StackIcon,
  WarningIcon,
  XIcon,
} from '@phosphor-icons/react';
import { useState } from 'react';
import type { Op, You } from '#shared/protocol';
import type { Board, Card } from '#shared/types';
import { HelpLink } from '@/components/HelpLink';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { type Analysis, type Run, useAnalysis } from '@/hooks/useAnalysis';
import {
  type ActionDraft,
  ANALYSIS_MODELS,
  type AnalysisAction,
  type Grouping,
  MODEL_SOURCE,
  type Theme,
} from '@/lib/analysis';
import { cn } from '@/lib/utils';
import { useMotion } from '@/providers/MotionProvider';
import { revealCard } from './action-link';

/**
 * The owner's Analysis panel. A small language model runs in this browser
 * (WebLLM, in a Web Worker) over the cards the owner's client already has,
 * and offers themes, groupings and action items. Everything it says is a
 * suggestion: the board changes only when the owner accepts one, and then
 * through an ordinary op like any other change.
 *
 * Only the toolbar renders this, and only for the owner; the component
 * refuses anyone else as well so a future caller cannot slip.
 */
export function AnalysisPanel({
  open,
  onOpenChange,
  board,
  you,
  dispatch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  board: Board;
  you: You;
  dispatch: (op: Op) => void;
}) {
  const analysis = useAnalysis(board, open && you.isOwner);
  const { active } = useMotion();
  const [tab, setTab] = useState<AnalysisAction>('themes');

  if (!you.isOwner) {
    return null;
  }

  function jumpToCard(cardId: string) {
    // The sheet is modal; close it first so the card is reachable.
    onOpenChange(false);
    window.setTimeout(() => revealCard(cardId, active), 0);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        <SheetHeader className="border-b p-4">
          <div className="flex items-center gap-2">
            <SheetTitle>Analysis</SheetTitle>
            <Badge variant="outline" className="text-[0.65rem]">
              AI suggestions
            </Badge>
            <HelpLink section="analysis" label="Analysis" />
          </div>
          <SheetDescription>
            A small model runs in this browser and reads the cards you can
            already see. Nothing leaves it, and nothing changes on the board
            until you accept a suggestion.
          </SheetDescription>
        </SheetHeader>

        <div className="scrollbar-thin flex-1 overflow-y-auto">
          {board.phase !== 'discuss' ? (
            <Notice>
              Analysis is available in Discuss, once everyone's cards are
              revealed and voted on.
            </Notice>
          ) : (
            <ModelGate analysis={analysis}>
              <Tabs
                value={tab}
                onValueChange={(value) => setTab(value as AnalysisAction)}
                className="gap-0"
              >
                <TabsList
                  aria-label="Analysis"
                  className="sticky top-0 z-10 w-full rounded-none border-b bg-popover p-0"
                  variant="line"
                >
                  <TabsTrigger value="themes" className="py-2">
                    <ListBulletsIcon data-icon="inline-start" />
                    Themes
                  </TabsTrigger>
                  <TabsTrigger value="groupings" className="py-2">
                    <StackIcon data-icon="inline-start" />
                    Groupings
                  </TabsTrigger>
                  <TabsTrigger value="actions" className="py-2">
                    <CheckSquareIcon data-icon="inline-start" />
                    Action items
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="themes" className="p-4">
                  <ActionRun
                    action="themes"
                    label="Summarise themes"
                    blurb="What the board is about, each theme citing the cards behind it."
                    run={analysis.results.themes}
                    analysis={analysis}
                    render={(theme, i) => (
                      <ThemeItem
                        theme={theme}
                        board={board}
                        onJump={jumpToCard}
                        onDismiss={() => analysis.dismiss('themes', i)}
                      />
                    )}
                  />
                </TabsContent>

                <TabsContent value="groupings" className="p-4">
                  <ActionRun
                    action="groupings"
                    label="Suggest groupings"
                    blurb="Cards that say the same thing. Accepting one stacks them, like dragging would."
                    run={analysis.results.groupings}
                    analysis={analysis}
                    render={(group, i) => (
                      <GroupingItem
                        group={group}
                        board={board}
                        onJump={jumpToCard}
                        onAccept={() => {
                          acceptGrouping(group, board, dispatch);
                          analysis.dismiss('groupings', i);
                        }}
                        onDismiss={() => analysis.dismiss('groupings', i)}
                      />
                    )}
                  />
                </TabsContent>

                <TabsContent value="actions" className="p-4">
                  <ActionRun
                    action="actions"
                    label="Draft action items"
                    blurb="Things the team could commit to. Accepting one adds it to the action items, linked to its card."
                    run={analysis.results.actions}
                    analysis={analysis}
                    render={(draft, i) => (
                      <ActionDraftItem
                        draft={draft}
                        board={board}
                        onJump={jumpToCard}
                        onAccept={() => {
                          dispatch({
                            type: 'addActionItem',
                            id: crypto.randomUUID(),
                            text: draft.text,
                            owner: '',
                            cardId: liveCard(board, draft.cardId)?.id ?? null,
                          });
                          analysis.dismiss('actions', i);
                        }}
                        onDismiss={() => analysis.dismiss('actions', i)}
                      />
                    )}
                  />
                </TabsContent>
              </Tabs>
            </ModelGate>
          )}
        </div>

        <p className="border-t px-4 py-2 text-[0.7rem] text-muted-foreground">
          Generated locally by {analysis.choice.name}. It can be wrong; read
          before you accept.
          {analysis.model.kind === 'ready' && (
            <>
              {' '}
              <button
                type="button"
                className="press rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
                disabled={analysis.busy}
                onClick={analysis.unload}
              >
                Change model
              </button>
            </>
          )}
        </p>
      </SheetContent>
    </Sheet>
  );
}

/** Group every cited card onto the first one, as a drag would. */
function acceptGrouping(
  group: Grouping,
  board: Board,
  dispatch: (op: Op) => void,
) {
  const live = group.cardIds
    .map((id) => liveCard(board, id))
    .filter((c): c is Card => c !== undefined);
  if (live.length < 2) {
    return;
  }
  const [target, ...rest] = live;
  const groupId = target.groupId ?? crypto.randomUUID();
  for (const card of rest) {
    dispatch({ type: 'groupCards', id: card.id, targetId: target.id, groupId });
  }
}

function liveCard(board: Board, cardId: string | null): Card | undefined {
  return cardId === null ? undefined : board.cards.find((c) => c.id === cardId);
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="p-6 text-center text-sm text-muted-foreground">{children}</p>
  );
}

/**
 * Before the model is ready: the browser check, the opt-in, the download
 * progress, or the error. Renders the children once it is.
 */
function ModelGate({
  analysis,
  children,
}: {
  analysis: Analysis;
  children: React.ReactNode;
}) {
  const { model } = analysis;
  switch (model.kind) {
    case 'unsupported':
      return (
        <Notice>
          Analysis is not supported in this browser. It needs WebGPU, which
          recent Chrome, Edge, Safari and Firefox have on most hardware.
        </Notice>
      );
    case 'consent':
      return (
        <div className="grid gap-4 p-4 text-sm">
          <fieldset className="grid gap-2">
            <legend className="sr-only">Model</legend>
            {ANALYSIS_MODELS.map((m) => {
              const selected = m.id === analysis.choice.id;
              return (
                <label
                  key={m.id}
                  className={cn(
                    'press grid cursor-pointer gap-1 rounded-md border p-3 outline-ring/50 transition-colors has-focus-visible:outline-2',
                    selected
                      ? 'border-foreground bg-muted/40'
                      : 'hover:bg-muted/40',
                  )}
                >
                  <input
                    type="radio"
                    name="analysis-model"
                    value={m.id}
                    checked={selected}
                    onChange={() => analysis.choose(m.id)}
                    className="sr-only"
                  />
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-foreground">
                      {m.name}
                    </span>
                    <span className="text-xs text-muted-foreground tabular">
                      {m.downloadLabel} · {m.vramLabel} of GPU memory
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {m.note}
                  </span>
                </label>
              );
            })}
          </fieldset>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <dt>Download</dt>
            <dd>
              {model.cached
                ? 'Already in this browser’s cache.'
                : `${analysis.choice.downloadLabel}, once. It stays cached in this browser.`}
            </dd>
            <dt>From</dt>
            <dd>{MODEL_SOURCE}. It sees the download, never the board.</dd>
            <dt>Runs on</dt>
            <dd>
              Your GPU, in this tab. Nobody else on the board is affected.
            </dd>
          </dl>
          <Button className="press" onClick={analysis.load}>
            <DownloadSimpleIcon data-icon="inline-start" />
            {model.cached
              ? `Load ${analysis.choice.name}`
              : `Download ${analysis.choice.name} and enable`}
          </Button>
        </div>
      );
    case 'loading':
      return (
        <div className="grid gap-3 p-4 text-sm">
          <p className="text-foreground">
            {model.fraction < 1 ? 'Loading the model…' : 'Almost there…'}
          </p>
          <div
            role="progressbar"
            aria-label="Model download"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(model.fraction * 100)}
            className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full origin-left bg-foreground transition-transform duration-(--duration-base) ease-(--ease-standard)"
              style={{ transform: `scaleX(${model.fraction})` }}
            />
          </div>
          <p className="line-clamp-2 text-xs text-muted-foreground">
            {model.text}
          </p>
          <Button
            variant="ghost"
            className="press justify-self-start"
            onClick={analysis.unload}
          >
            <XIcon data-icon="inline-start" />
            Cancel
          </Button>
        </div>
      );
    case 'error':
      return (
        <div className="grid gap-3 p-4 text-sm">
          <p className="flex items-start gap-2 text-foreground">
            <WarningIcon className="mt-0.5 shrink-0 text-destructive" />
            {model.message}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="press" onClick={analysis.load}>
              <ArrowClockwiseIcon data-icon="inline-start" />
              Try again
            </Button>
            <Button variant="ghost" className="press" onClick={analysis.unload}>
              Pick another model
            </Button>
          </div>
        </div>
      );
    case 'ready':
      return children;
  }
}

/** One of the three actions: its button, then its suggestions. */
function ActionRun<T>({
  action,
  label,
  blurb,
  run,
  analysis,
  render,
}: {
  action: AnalysisAction;
  label: string;
  blurb: string;
  run: Run<T>;
  analysis: Analysis;
  render: (item: T, index: number) => React.ReactNode;
}) {
  const running = run.status === 'running';
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">{blurb}</p>
      <Button
        variant={run.status === 'done' ? 'outline' : 'default'}
        className="press"
        disabled={analysis.busy}
        onClick={() => analysis.run(action)}
      >
        {run.status === 'done' ? (
          <ArrowClockwiseIcon data-icon="inline-start" />
        ) : (
          <SparkleIcon data-icon="inline-start" />
        )}
        {running ? 'Thinking…' : run.status === 'done' ? 'Run again' : label}
      </Button>
      {running && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          This takes a few seconds; the board keeps working meanwhile.
        </p>
      )}
      {run.status === 'error' && (
        <p className="flex items-start gap-2 text-sm text-foreground">
          <WarningIcon className="mt-0.5 shrink-0 text-destructive" />
          {run.message}
        </p>
      )}
      {run.status === 'done' && (
        <>
          {run.omitted > 0 && (
            <p className="text-xs text-muted-foreground">
              Based on the most-voted cards; {run.omitted} did not fit.
            </p>
          )}
          {run.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing usable came back. Try again.
            </p>
          ) : (
            <ul className="grid gap-2">
              {run.items.map((item, i) => (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: suggestions have no id and are only ever removed by index
                  key={i}
                  className="stagger-in rounded-md border p-3"
                  style={{ '--i': Math.min(i, 8) } as React.CSSProperties}
                >
                  {render(item, i)}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/** A cited card: its text, and a click that shows it on the board. */
function Citation({
  card,
  board,
  onJump,
}: {
  card: Card;
  board: Board;
  onJump: (cardId: string) => void;
}) {
  const column = board.columns.find((c) => c.id === card.columnId);
  return (
    <button
      type="button"
      onClick={() => onJump(card.id)}
      className="flex max-w-full items-center gap-1.5 rounded-sm text-left text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      aria-label={`Show the card: ${card.text}`}
    >
      <LinkSimpleIcon className="shrink-0" />
      <span className="truncate">{card.text}</span>
      {column && (
        <span className="shrink-0 text-muted-foreground/70">
          · {column.title}
        </span>
      )}
    </button>
  );
}

function DismissButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label="Dismiss suggestion"
      className="press -mt-1 -mr-1 shrink-0"
      onClick={onClick}
    >
      <XIcon />
    </Button>
  );
}

function ThemeItem({
  theme,
  board,
  onJump,
  onDismiss,
}: {
  theme: Theme;
  board: Board;
  onJump: (cardId: string) => void;
  onDismiss: () => void;
}) {
  const cards = theme.cardIds
    .map((id) => liveCard(board, id))
    .filter((c): c is Card => c !== undefined);
  return (
    <div className="grid gap-1.5">
      <div className="flex items-start gap-2">
        <p className="flex-1 text-sm font-medium text-foreground">
          {theme.title}
        </p>
        <DismissButton onClick={onDismiss} />
      </div>
      {theme.summary && <p className="text-sm">{theme.summary}</p>}
      {cards.length > 0 && (
        <ul className="grid gap-1 pt-1">
          {cards.map((card) => (
            <li key={card.id} className="min-w-0">
              <Citation card={card} board={board} onJump={onJump} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GroupingItem({
  group,
  board,
  onJump,
  onAccept,
  onDismiss,
}: {
  group: Grouping;
  board: Board;
  onJump: (cardId: string) => void;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const cards = group.cardIds
    .map((id) => liveCard(board, id))
    .filter((c): c is Card => c !== undefined);
  const possible = cards.length >= 2;
  return (
    <div className="grid gap-1.5">
      <div className="flex items-start gap-2">
        <p className="flex-1 text-sm font-medium text-foreground">
          {group.title || 'Group'}
        </p>
        <DismissButton onClick={onDismiss} />
      </div>
      <ul className="grid gap-1">
        {cards.map((card) => (
          <li key={card.id} className="min-w-0">
            <Citation card={card} board={board} onJump={onJump} />
          </li>
        ))}
      </ul>
      {possible ? (
        <Button
          size="sm"
          variant="secondary"
          className="press mt-1 justify-self-start"
          onClick={onAccept}
        >
          <StackIcon data-icon="inline-start" />
          Group these {cards.length} cards
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">
          Those cards are gone or already stacked.
        </p>
      )}
    </div>
  );
}

function ActionDraftItem({
  draft,
  board,
  onJump,
  onAccept,
  onDismiss,
}: {
  draft: ActionDraft;
  board: Board;
  onJump: (cardId: string) => void;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const card = liveCard(board, draft.cardId);
  return (
    <div className="grid gap-1.5">
      <div className="flex items-start gap-2">
        <p className="flex-1 text-sm text-foreground">{draft.text}</p>
        <DismissButton onClick={onDismiss} />
      </div>
      {card && <Citation card={card} board={board} onJump={onJump} />}
      <Button
        size="sm"
        variant="secondary"
        className="press mt-1 justify-self-start"
        onClick={onAccept}
      >
        <PlusIcon data-icon="inline-start" />
        Add action item
      </Button>
    </div>
  );
}
