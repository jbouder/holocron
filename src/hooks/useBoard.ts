import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Op, ServerMessage, You } from '#shared/protocol';
import { OpError, reduce } from '#shared/reducer';
import type { Actor, Board } from '#shared/types';
import { socketUrl } from '@/lib/api';

/**
 * The live connection to one board.
 *
 * `confirmed` is what the server has told us; `pending` are our own ops that
 * have not echoed back yet. The board we render is the confirmed board with
 * the pending ops replayed on top, so our changes show instantly and settle
 * into place when the echo (or a rejection) arrives.
 */

export type ConnectionStatus =
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'expired'
  | 'deleted'
  | 'missing'
  /** The board knows our participant id under another browser's secret. */
  | 'refused';

interface Pending {
  opId: string;
  op: Op;
  at: number;
}

export interface BoardConnection {
  status: ConnectionStatus;
  board: Board | null;
  you: You | null;
  /** Send an op. Returns false when the connection cannot take it right now. */
  send: (op: Op) => boolean;
  /** The most recent server rejection, for a toast. */
  rejection: { reason: string; at: number } | null;
  /**
   * An owner token the server did not accept (it rotated after a handoff,
   * or was never valid). The page forgets it.
   */
  refusedToken: string | null;
}

const MAX_BACKOFF_MS = 15_000;
const PING_MS = 30_000;

export function useBoard(
  code: string,
  identity: { id: string; secret: string; name: string },
  ownerToken: string | null,
): BoardConnection {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [confirmed, setConfirmed] = useState<Board | null>(null);
  const [you, setYou] = useState<You | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [rejection, setRejection] = useState<{
    reason: string;
    at: number;
  } | null>(null);
  const [refusedToken, setRefusedToken] = useState<string | null>(null);

  const socket = useRef<WebSocket | null>(null);
  const seq = useRef(0);
  const attempts = useRef(0);
  const closedForGood = useRef(false);
  const pendingRef = useRef<Pending[]>([]);
  pendingRef.current = pending;
  // Read at connect time, so a token claimed mid-session is used on the next
  // reconnect without forcing one now (the server already updated `you`).
  const ownerTokenRef = useRef(ownerToken);
  ownerTokenRef.current = ownerToken;

  const actor = useMemo<Actor>(
    () => ({
      id: identity.id,
      name: you?.name ?? identity.name,
      isOwner: you?.isOwner ?? false,
      anonymousCardIds: you?.anonymousCardIds ?? [],
      anonymousCommentIds: you?.anonymousCommentIds ?? [],
    }),
    [identity.id, identity.name, you],
  );

  useEffect(() => {
    if (!identity.name) {
      return;
    }
    closedForGood.current = false;
    let reconnectTimer: number | undefined;
    let pingTimer: number | undefined;
    let cancelled = false;

    const connect = () => {
      if (cancelled) {
        return;
      }
      const token = ownerTokenRef.current;
      const ws = new WebSocket(socketUrl(code, identity, token));
      socket.current = ws;

      ws.addEventListener('open', () => {
        attempts.current = 0;
        setStatus('open');
        // Replay anything the previous socket did not get to confirm.
        for (const p of pendingRef.current) {
          ws.send(JSON.stringify({ type: 'op', opId: p.opId, op: p.op }));
        }
        pingTimer = window.setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send('ping');
          }
        }, PING_MS);
      });

      ws.addEventListener('message', (event) => {
        if (typeof event.data !== 'string' || event.data === 'pong') {
          return;
        }
        let message: ServerMessage;
        try {
          message = JSON.parse(event.data) as ServerMessage;
        } catch {
          return;
        }
        switch (message.type) {
          case 'snapshot':
            seq.current = message.seq;
            setConfirmed(message.board);
            setYou(message.you);
            if (token && !message.you.isOwner) {
              setRefusedToken(token);
            }
            break;
          case 'op': {
            if (
              message.seq !== seq.current + 1 &&
              message.seq !== seq.current
            ) {
              // We missed something; ask for the whole board again.
              ws.send(JSON.stringify({ type: 'sync' }));
              return;
            }
            seq.current = message.seq;
            const { op, actor: by, at, opId } = message;
            setConfirmed((board) => {
              if (!board) {
                return board;
              }
              try {
                return reduce(
                  board,
                  op,
                  {
                    id: by.id,
                    name: by.name,
                    // An anonymous author's echo has an empty id; the lists
                    // say which item is theirs (see `Actor`).
                    isOwner: by.id !== '' && by.id === board.ownerId,
                    anonymousCardIds: by.anonymousCardIds,
                    anonymousCommentIds: by.anonymousCommentIds,
                  },
                  at,
                );
              } catch {
                // Our view disagrees with the server's: resync rather than guess.
                ws.send(JSON.stringify({ type: 'sync' }));
                return board;
              }
            });
            setPending((list) => list.filter((p) => p.opId !== opId));
            if (by.id === identity.id) {
              // Our own op (possibly from another tab): keep `you` current.
              if (op.type === 'setName') {
                setYou((me) => (me ? { ...me, name: op.name } : me));
              } else if (op.type === 'addCard' && op.anonymous) {
                setYou((me) =>
                  me
                    ? {
                        ...me,
                        anonymousCardIds: [...me.anonymousCardIds, op.id],
                      }
                    : me,
                );
              } else if (op.type === 'addComment' && op.anonymous) {
                setYou((me) =>
                  me
                    ? {
                        ...me,
                        anonymousCommentIds: [...me.anonymousCommentIds, op.id],
                      }
                    : me,
                );
              }
            }
            break;
          }
          case 'presence':
            setConfirmed((board) =>
              board ? { ...board, participants: message.participants } : board,
            );
            break;
          case 'rejected':
            setPending((list) => list.filter((p) => p.opId !== message.opId));
            setRejection({ reason: message.reason, at: Date.now() });
            break;
          case 'expired':
          case 'deleted':
            closedForGood.current = true;
            setStatus(message.type);
            break;
        }
      });

      ws.addEventListener('close', (event) => {
        window.clearInterval(pingTimer);
        if (cancelled || closedForGood.current) {
          return;
        }
        // 1008 = the server refused us (bad name, full board, no board).
        if (event.code === 1008 || event.code === 1000) {
          if (event.reason === 'expired' || event.reason === 'deleted') {
            closedForGood.current = true;
            setStatus(event.reason);
            return;
          }
        }
        if (event.code === 1008 && event.reason === 'identity') {
          // Retrying with the same id and secret cannot succeed.
          closedForGood.current = true;
          setStatus('refused');
          return;
        }
        if (event.code === 1013) {
          // Too many lookups from this address: the board is there, so
          // wait it out and never call it missing.
          setStatus('reconnecting');
          reconnectTimer = window.setTimeout(connect, MAX_BACKOFF_MS);
          return;
        }
        // The upgrade itself failed (404 for a missing board shows up as an
        // immediate close with code 1006 before any snapshot).
        if (
          seq.current === 0 &&
          !confirmedRef.current &&
          attempts.current >= 2
        ) {
          closedForGood.current = true;
          setStatus('missing');
          return;
        }
        setStatus('reconnecting');
        attempts.current += 1;
        const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** attempts.current);
        reconnectTimer = window.setTimeout(connect, delay);
      });

      ws.addEventListener('error', () => {
        // The close event follows and handles the retry.
      });
    };

    connect();

    return () => {
      cancelled = true;
      window.clearTimeout(reconnectTimer);
      window.clearInterval(pingTimer);
      socket.current?.close(1000, 'leaving');
      socket.current = null;
    };
  }, [code, identity]);

  const confirmedRef = useRef<Board | null>(null);
  confirmedRef.current = confirmed;

  const send = useCallback(
    (op: Op): boolean => {
      const ws = socket.current;
      if (!confirmedRef.current) {
        return false;
      }
      // Try it locally first so an impossible op never leaves the browser.
      try {
        reduce(
          replay(confirmedRef.current, pendingRef.current, actor),
          op,
          actor,
        );
      } catch (error) {
        if (error instanceof OpError) {
          setRejection({ reason: error.message, at: Date.now() });
          return false;
        }
        throw error;
      }
      const entry: Pending = { opId: crypto.randomUUID(), op, at: Date.now() };
      setPending((list) => [...list, entry]);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'op', opId: entry.opId, op }));
      }
      return true;
    },
    [actor],
  );

  const board = useMemo(
    () => (confirmed ? replay(confirmed, pending, actor) : null),
    [confirmed, pending, actor],
  );

  return { status, board, you, send, rejection, refusedToken };
}

function replay(board: Board, pending: Pending[], actor: Actor): Board {
  let next = board;
  for (const p of pending) {
    try {
      next = reduce(next, p.op, actor, p.at);
    } catch {
      // The server will reject it too; leave the confirmed state as is.
    }
  }
  return next;
}
