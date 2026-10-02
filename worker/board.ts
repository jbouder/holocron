import { DurableObject } from 'cloudflare:workers';
import { boardToMarkdown } from '#shared/export';
import { LIMITS } from '#shared/limits';
import {
  type BoardMeta,
  ClientMessageSchema,
  type Op,
  type ServerMessage,
  type You,
} from '#shared/protocol';
import { createBoard, OpError, reduce, upgradeBoard } from '#shared/reducer';
import type { Actor, Board } from '#shared/types';
import type { Bindings } from './env';

/**
 * One Durable Object per board. Its SQLite storage holds the board document
 * (one JSON row plus a sequence number), its WebSockets are the live
 * participants, and its alarm is the daily wipe. When the alarm fires the
 * object deletes everything it has, so an expired board leaves no trace.
 */

type Row = Record<string, SqlStorageValue> & {
  json: string;
  seq: number;
  owner_hash: string;
};

/** What each socket remembers across hibernation. */
interface Attachment {
  id: string;
  name: string;
  isOwner: boolean;
}

export interface CreateInput {
  code: string;
  title: string;
  templateId: string;
  ownerId: string;
  ownerName: string;
  expiresAt: number;
}

export class BoardObject extends DurableObject<Bindings> {
  private board: Board | null = null;
  private seq = 0;
  private ownerHash: string | null = null;
  /** Per-socket timestamps of recent ops, for the flood limit. */
  private recent = new WeakMap<WebSocket, number[]>();

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.load();
      // Keep-alives answered by the runtime without waking the object.
      this.ctx.setWebSocketAutoResponse(
        new WebSocketRequestResponsePair('ping', 'pong'),
      );
    });
  }

  /* ---------- storage ---------- */

  private ensureTable() {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS board (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        json TEXT NOT NULL,
        seq INTEGER NOT NULL,
        owner_hash TEXT NOT NULL
      )
    `);
  }

  private load() {
    this.ensureTable();
    const row = this.ctx.storage.sql
      .exec<Row>('SELECT json, seq, owner_hash FROM board WHERE id = 1')
      .toArray()[0];
    if (row) {
      this.board = upgradeBoard(JSON.parse(row.json) as Board);
      this.seq = row.seq;
      this.ownerHash = row.owner_hash;
    }
  }

  private persist() {
    if (!this.board || this.ownerHash === null) {
      return;
    }
    this.ctx.storage.sql.exec(
      `INSERT INTO board (id, json, seq, owner_hash) VALUES (1, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET json = excluded.json, seq = excluded.seq`,
      JSON.stringify(this.stripPresence(this.board)),
      this.seq,
      this.ownerHash,
    );
  }

  /** `online` is derived from sockets; never store it. */
  private stripPresence(board: Board): Board {
    return {
      ...board,
      participants: board.participants.map((p) => ({ ...p, online: false })),
    };
  }

  /** Wipe everything: storage, alarm, sockets. The object is now empty. */
  private async wipe(reason: 'expired' | 'deleted') {
    const message: ServerMessage = { type: reason };
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(JSON.stringify(message));
        ws.close(1000, reason);
      } catch {
        // Already closed.
      }
    }
    this.board = null;
    this.seq = 0;
    this.ownerHash = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  /** The alarm is the primary wipe; this is the belt to its braces. */
  private async expireIfDue(now = Date.now()) {
    if (this.board && this.board.expiresAt <= now) {
      await this.wipe('expired');
    }
  }

  /* ---------- RPC (called by the Worker) ---------- */

  /** Returns the owner token, or null if this code is already in use. */
  async create(input: CreateInput): Promise<string | null> {
    await this.expireIfDue();
    if (this.board) {
      return null;
    }
    const token = randomToken();
    this.ensureTable();
    this.ownerHash = await sha256(token);
    this.board = createBoard({
      code: input.code,
      title: input.title,
      templateId: input.templateId,
      ownerId: input.ownerId,
      ownerName: input.ownerName,
      createdAt: Date.now(),
      expiresAt: input.expiresAt,
    });
    this.seq = 0;
    this.persist();
    await this.ctx.storage.setAlarm(input.expiresAt);
    return token;
  }

  async meta(): Promise<BoardMeta | null> {
    await this.expireIfDue();
    if (!this.board) {
      return null;
    }
    return {
      code: this.board.code,
      title: this.board.title,
      expiresAt: this.board.expiresAt,
      participants: this.onlineIds().size,
      cards: this.board.cards.length,
    };
  }

  async destroy(token: string): Promise<'ok' | 'forbidden' | 'missing'> {
    await this.expireIfDue();
    if (!this.board || this.ownerHash === null) {
      return 'missing';
    }
    if ((await sha256(token)) !== this.ownerHash) {
      return 'forbidden';
    }
    await this.wipe('deleted');
    return 'ok';
  }

  async exportMarkdown(): Promise<string | null> {
    await this.expireIfDue();
    return this.board ? boardToMarkdown(this.withPresence(this.board)) : null;
  }

  /* ---------- WebSocket upgrade ---------- */

  async fetch(request: Request): Promise<Response> {
    await this.expireIfDue();
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket', { status: 426 });
    }
    if (!this.board) {
      return new Response('This board has expired or never existed', {
        status: 404,
      });
    }
    const url = new URL(request.url);
    const id = (url.searchParams.get('pid') ?? '').slice(0, 64);
    const name = (url.searchParams.get('name') ?? '')
      .trim()
      .slice(0, LIMITS.nameMax);
    const token = url.searchParams.get('token');
    if (!id || !name) {
      return new Response('Missing participant id or name', { status: 400 });
    }
    const isOwner =
      token !== null &&
      this.ownerHash !== null &&
      (await sha256(token)) === this.ownerHash;

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const attachment: Attachment = { id, name, isOwner };
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server);

    // Make sure the participant exists with this name. Going through the
    // reducer persists it and tells everyone else.
    const actor = this.actorFor(attachment);
    const known = this.board.participants.find((p) => p.id === id);
    if (!known || known.name !== name) {
      try {
        this.apply({ type: 'setName', name }, actor, `join-${id}`, [server]);
      } catch (error) {
        if (error instanceof OpError) {
          server.close(1008, error.message);
          return new Response(null, { status: 101, webSocket: client });
        }
        throw error;
      }
    }

    this.sendSnapshot(server, actor);
    this.broadcastPresence();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    await this.expireIfDue();
    if (!this.board) {
      ws.close(1000, 'expired');
      return;
    }
    if (typeof raw !== 'string' || !this.allow(ws)) {
      return;
    }
    const attachment = ws.deserializeAttachment() as Attachment;
    const actor = this.actorFor(attachment);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const result = ClientMessageSchema.safeParse(parsed);
    if (!result.success) {
      return;
    }
    const message = result.data;

    if (message.type === 'sync') {
      this.sendSnapshot(ws, actor);
      return;
    }

    let op: Op = message.op;
    if (op.type === 'setTimer') {
      // The server's clock decides when the timer ends.
      op = { ...op, endsAt: Date.now() + op.durationMs };
    }
    try {
      this.apply(op, actor, message.opId, []);
      if (op.type === 'setName') {
        ws.serializeAttachment({ ...attachment, name: op.name });
        this.broadcastPresence();
      }
    } catch (error) {
      if (error instanceof OpError) {
        this.send(ws, {
          type: 'rejected',
          opId: message.opId,
          reason: error.message,
        });
        return;
      }
      throw error;
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    try {
      ws.close(code, reason);
    } catch {
      // Already closed by the peer.
    }
    this.broadcastPresence();
  }

  async webSocketError(ws: WebSocket) {
    try {
      ws.close(1011, 'error');
    } catch {
      // Already closed.
    }
    this.broadcastPresence();
  }

  /* ---------- the daily wipe ---------- */

  async alarm() {
    await this.wipe('expired');
  }

  /* ---------- internals ---------- */

  /**
   * Validate through the reducer, persist, and broadcast. Throws OpError
   * when the reducer refuses. `except` lists sockets that should not get the
   * echo (used for the join rename, which the joiner learns from the snapshot).
   */
  private apply(op: Op, actor: Actor, opId: string, except: WebSocket[]) {
    if (!this.board) {
      throw new OpError('This board has expired');
    }
    const at = Date.now();
    const next = reduce(this.board, op, actor, at);
    this.board = next;
    this.seq += 1;
    this.persist();
    const message: ServerMessage = {
      type: 'op',
      seq: this.seq,
      op,
      opId,
      actor: { id: actor.id, name: actor.name },
      at,
    };
    const skip = new Set(except);
    for (const ws of this.ctx.getWebSockets()) {
      if (!skip.has(ws)) {
        this.send(ws, message);
      }
    }
  }

  private actorFor(attachment: Attachment): Actor {
    return {
      id: attachment.id,
      name: attachment.name,
      isOwner: attachment.isOwner,
    };
  }

  private send(ws: WebSocket, message: ServerMessage) {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // Socket is closing; the close handler will update presence.
    }
  }

  private sendSnapshot(ws: WebSocket, actor: Actor) {
    if (!this.board) {
      return;
    }
    const board = this.withPresence(this.board);
    const you: You = { id: actor.id, name: actor.name, isOwner: actor.isOwner };
    this.send(ws, { type: 'snapshot', board, seq: this.seq, you });
  }

  private onlineIds(): Set<string> {
    const ids = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as Attachment | null;
      if (attachment) {
        ids.add(attachment.id);
      }
    }
    return ids;
  }

  private withPresence(board: Board): Board {
    const online = this.onlineIds();
    return {
      ...board,
      participants: board.participants.map((p) => ({
        ...p,
        online: online.has(p.id),
      })),
    };
  }

  private broadcastPresence() {
    if (!this.board) {
      return;
    }
    const message: ServerMessage = {
      type: 'presence',
      participants: this.withPresence(this.board).participants,
    };
    for (const ws of this.ctx.getWebSockets()) {
      this.send(ws, message);
    }
  }

  /** Sliding one-second window per socket. */
  private allow(ws: WebSocket): boolean {
    const now = Date.now();
    const stamps = (this.recent.get(ws) ?? []).filter((t) => now - t < 1000);
    if (stamps.length >= LIMITS.opsPerSecond) {
      this.recent.set(ws, stamps);
      return false;
    }
    stamps.push(now);
    this.recent.set(ws, stamps);
    return true;
  }
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
