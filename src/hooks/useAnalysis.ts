import { useCallback, useEffect, useRef, useState } from 'react';
import type { Board } from '#shared/types';
import {
  ACTION_PROMPTS,
  type ActionDraft,
  type AnalysisAction,
  type AnalysisModel,
  describeBoard,
  findModel,
  type Grouping,
  parseActionDrafts,
  parseGroupings,
  parseThemes,
  type Theme,
} from '@/lib/analysis';
import {
  AnalysisEngine,
  isModelCached,
  webGpuSupported,
} from '@/lib/analysis-engine';

/**
 * The owner's local model and what it has said so far. Lives for as long as
 * the Analysis panel is mounted (the whole board visit), so results survive
 * closing and reopening the sheet. Nothing here touches the board document;
 * accepting a suggestion is the panel's job, through `dispatch`.
 */

export type ModelState =
  | { kind: 'unsupported' }
  /** Waiting for the owner to agree to the download. `cached` is unknown until checked. */
  | { kind: 'consent'; cached: boolean | null }
  | { kind: 'loading'; fraction: number; text: string }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

export type Run<T> =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; items: T[]; omitted: number }
  | { status: 'error'; message: string };

export interface AnalysisResults {
  themes: Run<Theme>;
  groupings: Run<Grouping>;
  actions: Run<ActionDraft>;
}

export interface Analysis {
  model: ModelState;
  /** Which model the owner picked; remembered in this browser. */
  choice: AnalysisModel;
  results: AnalysisResults;
  /** A generation is in flight; one at a time keeps the GPU predictable. */
  busy: boolean;
  /** Pick another model. Unloads the current one, if any. */
  choose: (modelId: string) => void;
  /** The owner agreed: download if needed, then load. */
  load: () => void;
  /** Back to the opt-in step, freeing the GPU. The cache keeps the weights. */
  unload: () => void;
  run: (action: AnalysisAction) => void;
  /** Drop one suggestion, accepted or not. */
  dismiss: (action: AnalysisAction, index: number) => void;
}

const IDLE: Run<never> = { status: 'idle' };
const CHOICE_KEY = 'holocron:analysis-model';

function storedChoice(): AnalysisModel {
  try {
    return findModel(localStorage.getItem(CHOICE_KEY));
  } catch {
    return findModel(null);
  }
}

function rememberChoice(model: AnalysisModel) {
  try {
    localStorage.setItem(CHOICE_KEY, model.id);
  } catch {
    // Private mode or a full store: the pick still holds for this visit.
  }
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/out of memory|OOM|device lost|buffer size/i.test(message)) {
    return 'The model does not fit in this device’s GPU memory. Try a smaller one.';
  }
  if (/fetch|network|Failed to load/i.test(message)) {
    return 'The download failed. Check the connection and try again.';
  }
  return message || 'Something went wrong.';
}

export function useAnalysis(board: Board, open: boolean): Analysis {
  const [model, setModel] = useState<ModelState>(() =>
    webGpuSupported()
      ? { kind: 'consent', cached: null }
      : { kind: 'unsupported' },
  );
  const [choice, setChoice] = useState<AnalysisModel>(storedChoice);
  const [results, setResults] = useState<AnalysisResults>({
    themes: IDLE,
    groupings: IDLE,
    actions: IDLE,
  });
  const [busy, setBusy] = useState(false);
  const engine = useRef<AnalysisEngine | null>(null);
  const boardRef = useRef(board);
  boardRef.current = board;

  // Opening the panel is what pulls the library in; the cache check is
  // cheap and changes the wording of the consent step. Once per model.
  const checkedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!open || model.kind !== 'consent' || checkedFor.current === choice.id) {
      return;
    }
    checkedFor.current = choice.id;
    let cancelled = false;
    isModelCached(choice.id).then((cached) => {
      if (!cancelled) {
        setModel((m) => (m.kind === 'consent' ? { ...m, cached } : m));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, model.kind, choice.id]);

  useEffect(
    () => () => {
      engine.current?.dispose();
      engine.current = null;
    },
    [],
  );

  const unload = useCallback(() => {
    if (busy) {
      return;
    }
    engine.current?.dispose();
    engine.current = null;
    setModel((m) =>
      m.kind === 'unsupported'
        ? m
        : { kind: 'consent', cached: m.kind === 'ready' ? true : null },
    );
  }, [busy]);

  const choose = useCallback(
    (modelId: string) => {
      if (busy) {
        return;
      }
      const next = findModel(modelId);
      if (next.id === choice.id) {
        return;
      }
      engine.current?.dispose();
      engine.current = null;
      setChoice(next);
      rememberChoice(next);
      setModel((m) =>
        m.kind === 'unsupported' ? m : { kind: 'consent', cached: null },
      );
    },
    [busy, choice.id],
  );

  const load = useCallback(() => {
    if (engine.current) {
      return;
    }
    const next = new AnalysisEngine();
    engine.current = next;
    setModel({ kind: 'loading', fraction: 0, text: 'Starting…' });
    next
      .load(choice.id, (progress) => {
        if (engine.current === next) {
          setModel({ kind: 'loading', ...progress });
        }
      })
      .then(() => {
        if (engine.current === next) {
          setModel({ kind: 'ready' });
        }
      })
      .catch((error: unknown) => {
        if (engine.current === next) {
          engine.current = null;
          setModel({ kind: 'error', message: describeError(error) });
        }
      });
  }, [choice.id]);

  const run = useCallback(
    (action: AnalysisAction) => {
      const current = engine.current;
      if (!current || busy) {
        return;
      }
      setBusy(true);
      setResults((r) => ({ ...r, [action]: { status: 'running' } }));
      const snapshot = boardRef.current;
      const context = describeBoard(snapshot);
      const { instruction, schema } = ACTION_PROMPTS[action];
      current
        .complete(context.text, instruction, schema)
        .then((raw) => {
          const omitted = context.omitted;
          const done = <T>(items: T[]): Run<T> => ({
            status: 'done',
            items,
            omitted,
          });
          setResults((r) => {
            switch (action) {
              case 'themes':
                return { ...r, themes: done(parseThemes(raw, context.refs)) };
              case 'groupings':
                return {
                  ...r,
                  groupings: done(
                    parseGroupings(raw, context.refs, boardRef.current.cards),
                  ),
                };
              case 'actions':
                return {
                  ...r,
                  actions: done(parseActionDrafts(raw, context.refs)),
                };
            }
          });
        })
        .catch((error: unknown) => {
          setResults((r) => ({
            ...r,
            [action]: { status: 'error', message: describeError(error) },
          }));
        })
        .finally(() => setBusy(false));
    },
    [busy],
  );

  const dismiss = useCallback((action: AnalysisAction, index: number) => {
    setResults((r) => {
      const run = r[action];
      if (run.status !== 'done') {
        return r;
      }
      return {
        ...r,
        [action]: { ...run, items: run.items.filter((_, i) => i !== index) },
      };
    });
  }, []);

  return { model, choice, results, busy, choose, load, unload, run, dismiss };
}
