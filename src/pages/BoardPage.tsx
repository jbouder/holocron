import { useEffect, useRef, useState } from 'react';
import type { Op } from '#shared/protocol';
import { BoardToolbar } from '@/components/board/BoardToolbar';
import { Columns } from '@/components/board/Columns';
import { NameDialog } from '@/components/NameDialog';
import { useBoard } from '@/hooks/useBoard';
import { ApiError, getBoardMeta } from '@/lib/api';
import { getOwnerToken, useIdentity } from '@/lib/identity';
import { withViewTransition } from '@/lib/motion';
import { rememberBoard } from '@/lib/recent-boards';
import { markGone, navigate } from '@/lib/router';
import { useMotion } from '@/providers/MotionProvider';
import { useToast } from '@/providers/ToastProvider';

/**
 * One board. Checks the board exists, asks for a name if needed, then hands
 * the live connection to the toolbar and the columns.
 */
export function BoardPage({ code }: { code: string }) {
  const identity = useIdentity();
  const toast = useToast();
  const { active } = useMotion();
  const [ownerToken] = useState(() => getOwnerToken(code));
  const [checked, setChecked] = useState(false);
  const connection = useBoard(code, identity, ownerToken);
  const { status, board, you, send, rejection } = connection;

  // Does the board exist at all? Cheaper and clearer than a failing socket.
  useEffect(() => {
    let cancelled = false;
    getBoardMeta(code)
      .then((meta) => {
        if (cancelled) {
          return;
        }
        rememberBoard({
          code,
          title: meta.title,
          expiresAt: meta.expiresAt,
          owner: ownerToken !== null,
        });
        setChecked(true);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        if (error instanceof ApiError && error.status === 404) {
          markGone('missing', code);
        } else {
          setChecked(true); // let the socket retry
        }
      });
    return () => {
      cancelled = true;
    };
  }, [code, ownerToken]);

  // Keep the recent-boards title fresh when the owner renames it.
  useEffect(() => {
    if (board) {
      rememberBoard({
        code,
        title: board.title,
        expiresAt: board.expiresAt,
        owner: you?.isOwner ?? false,
      });
    }
  }, [board, code, you?.isOwner]);

  useEffect(() => {
    if (status === 'expired' || status === 'deleted' || status === 'missing') {
      markGone(status, code);
    }
  }, [status, code]);

  // Server rejections become toasts.
  const lastRejection = useRef<number>(0);
  useEffect(() => {
    if (rejection && rejection.at !== lastRejection.current) {
      lastRejection.current = rejection.at;
      toast.show(rejection.reason);
    }
  }, [rejection, toast]);

  // `?` opens help from the board (not while typing).
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (
        event.key === '?' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !(target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) &&
        !target?.isContentEditable
      ) {
        event.preventDefault();
        navigate({ name: 'help' });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** Phase changes run inside a typed view transition. */
  function dispatch(op: Op) {
    if (op.type === 'setPhase') {
      withViewTransition(() => send(op), active, 'phase');
      return;
    }
    send(op);
  }

  const needsName = !identity.name;

  return (
    <div className="flex flex-1 flex-col">
      <NameDialog open={needsName} onOpenChange={() => undefined} required />

      <div
        className={`banner items-center justify-center gap-2 border-b bg-muted/60 px-4 py-1.5 text-xs text-muted-foreground ${
          status === 'reconnecting' ? 'open' : ''
        }`}
        role="status"
      >
        <span className="size-1.5 animate-pulse rounded-full bg-foreground/60" />
        Reconnecting…
      </div>

      {board && you ? (
        <>
          <BoardToolbar
            board={board}
            you={you}
            ownerToken={ownerToken}
            dispatch={dispatch}
          />
          <Columns board={board} you={you} dispatch={dispatch} />
        </>
      ) : (
        <BoardSkeleton waiting={checked && !needsName} />
      )}
    </div>
  );
}

function BoardSkeleton({ waiting }: { waiting: boolean }) {
  return (
    <div
      className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6"
      aria-busy="true"
    >
      <div className="mb-6 flex items-center gap-3">
        <div className="h-7 w-48 rounded bg-muted" />
        <div className="h-5 w-20 rounded bg-muted" />
      </div>
      <div className="board-columns">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-64 rounded-lg border bg-muted/30" />
        ))}
      </div>
      <p className="sr-only">
        {waiting ? 'Connecting to the board' : 'Loading'}
      </p>
    </div>
  );
}
