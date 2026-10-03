import { DurableObject } from 'cloudflare:workers';
import { generateCode, normalizeCode } from '#shared/codes';
import { type ExportFormat, exportBoard } from '#shared/export';
import { LIMITS } from '#shared/limits';
import {
  type BoardMeta,
  type BoardOp,
  ClientMessageSchema,
  type HandoffResponse,
  type Op,
  type OpActor,
  type ServerMessage,
  type You,
} from '#shared/protocol';
import {
  anonymousIdsFor,
  blursCards,
  createBoard,
  OpError,
  redactAnonymous,
  redactHidden,
  redactHiddenOp,
  reduce,
  upgradeBoard,
} from '#shared/reducer';
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

export interface RedeemInput {
  participantId: string;
  secret: string;
  code: string;
}

export type RedeemResult =
  | { ok: true; ownerToken: string }
  | {
      ok: false;
      reason: 'missing' | 'limited' | 'stranger' | 'owner' | 'invalid';
    };

/** A pending ownership handoff. Only the code's hash is kept. */
interface Handoff {
  hash: string;
  expiresAt: number;
}

/** Storage key (KV side of the same SQLite) for the participant bindings. */
const SECRETS_KEY = 'participantSecrets';
/** Storage key for the pending handoff, if any. */
const HANDOFF_KEY = 'handoff';

export class BoardObject extends DurableObject<Bindings> {
  private board: Board | null = null;
  private seq = 0;
  private ownerHash: string | null = null;
  /**
   * Participant id → SHA-256 of the browser secret that first used it. A
   * later socket with that id and another secret is refused, so nobody can
   * act (or read `you`) as someone else. Never sent to clients.
   */
  private secrets: Record<string, string> = {};
  /** At most one live handoff code; creating another replaces it. */
  private handoff: Handoff | null = null;
  /** Times of recent wrong handoff codes, for the guessing limit. */
  private handoffMisses: number[] = [];
  /** Per-socket timestamps of recent ops, for the flood limit. */
  private recent = new WeakMap<WebSocket, number[]>();

  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.load();
      if (this.board) {
        this.secrets =
          (await ctx.storage.get<Record<string, string>>(SECRETS_KEY)) ?? {};
        this.handoff = (await ctx.storage.get<Handoff>(HANDOFF_KEY)) ?? null;
      }
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
    // Only `create()` makes the table. Probing a code that was never created
    // (or has been wiped) must leave this object's storage empty.
    const exists = this.ctx.storage.sql
      .exec(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'board'",
      )
      .toArray().length;
    if (!exists) {
      return;
    }
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
       ON CONFLICT(id) DO UPDATE SET
         json = excluded.json,
         seq = excluded.seq,
         owner_hash = excluded.owner_hash`,
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
    this.secrets = {};
    this.handoff = null;
    this.handoffMisses = [];
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
    this.secrets = {};
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

  /**
   * Issue a one-time code the owner reads to the next owner. Replaces any
   * earlier code. Only the hash is stored, and `wipe()` takes it with
   * everything else.
   */
  async startHandoff(
    token: string,
  ): Promise<HandoffResponse | 'forbidden' | 'missing'> {
    await this.expireIfDue();
    if (!this.board || this.ownerHash === null) {
      return 'missing';
    }
    if ((await sha256(token)) !== this.ownerHash) {
      return 'forbidden';
    }
    const code = generateCode();
    const handoff: Handoff = {
      hash: await sha256(code),
      expiresAt: Math.min(
        Date.now() + LIMITS.handoffTtlMs,
        this.board.expiresAt,
      ),
    };
    this.handoff = handoff;
    await this.ctx.storage.put(HANDOFF_KEY, handoff);
    return { code, expiresAt: handoff.expiresAt };
  }

  /**
   * Redeem a handoff code for the participant whose browser secret comes
   * with it. Rotates the owner token, so the previous owner's token stops
   * working everywhere, and moves `board.ownerId` through the reducer.
   */
  async redeemHandoff(input: RedeemInput): Promise<RedeemResult> {
    await this.expireIfDue();
    if (!this.board || this.ownerHash === null) {
      return { ok: false, reason: 'missing' };
    }
    // Hash everything up front: from here to the rotation nothing awaits,
    // so two redeems of one code cannot both get through.
    const [secretHash, codeHash] = await Promise.all([
      sha256(input.secret),
      sha256(normalizeCode(input.code)),
    ]);
    const ownerToken = randomToken();
    const ownerHash = await sha256(ownerToken);

    const now = Date.now();
    this.handoffMisses = this.handoffMisses.filter((t) => now - t < 60_000);
    if (this.handoffMisses.length >= LIMITS.handoffAttemptsPerMinute) {
      return { ok: false, reason: 'limited' };
    }
    // The same check a socket gets: the id has to be seated on this board
    // and bound to this browser's secret.
    const id = input.participantId;
    if (
      this.secrets[id] !== secretHash ||
      !this.board.participants.some((p) => p.id === id)
    ) {
      return { ok: false, reason: 'stranger' };
    }
    if (this.board.ownerId === id) {
      return { ok: false, reason: 'owner' };
    }
    const handoff = this.handoff;
    if (!handoff || handoff.expiresAt <= now || handoff.hash !== codeHash) {
      this.handoffMisses.push(now);
      return { ok: false, reason: 'invalid' };
    }

    this.handoff = null;
    this.ownerHash = ownerHash;
    const from = this.board.participants.find(
      (p) => p.id === this.board?.ownerId,
    );
    // Persists the new hash with the document.
    this.apply(
      { type: 'setOwner', participantId: id },
      { id: this.board.ownerId, name: from?.name ?? '', isOwner: true },
      `handoff-${crypto.randomUUID()}`,
      [],
    );
    // Live sockets follow without reconnecting: the old token's sockets
    // lose ownership, the new owner's gain it, and each gets a fresh `you`.
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as Attachment | null;
      if (!attachment || attachment.isOwner === (attachment.id === id)) {
        continue;
      }
      const next: Attachment = { ...attachment, isOwner: attachment.id === id };
      ws.serializeAttachment(next);
      this.sendSnapshot(ws, this.actorFor(next));
    }
    await this.ctx.storage.delete(HANDOFF_KEY);
    return { ok: true, ownerToken };
  }

  async export(format: ExportFormat): Promise<string | null> {
    await this.expireIfDue();
    return this.board
      ? exportBoard(this.withPresence(this.board), format)
      : null;
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
    const secret = url.searchParams.get('secret') ?? '';
    const name = (url.searchParams.get('name') ?? '')
      .trim()
      .slice(0, LIMITS.nameMax);
    const token = url.searchParams.get('token');
    if (!id || !name || !secret || secret.length > 128) {
      return new Response('Missing participant id, secret or name', {
        status: 400,
      });
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

    // Bind the id to this browser's secret, or refuse an impostor. The
    // close reason is what the client keys on; it never retries this.
    const secretHash = await sha256(secret);
    const bound = this.secrets[id];
    if (bound === undefined) {
      this.secrets[id] = secretHash;
      await this.ctx.storage.put(SECRETS_KEY, this.secrets);
    } else if (bound !== secretHash) {
      server.close(1008, 'identity');
      return new Response(null, { status: 101, webSocket: client });
    }

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
    if (typeof raw !== 'string') {
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

    if (!this.allow(ws)) {
      // Refuse rather than drop, so the sender's optimistic copy is rolled
      // back instead of lingering until the next reconnect.
      if (message.type === 'op') {
        this.send(ws, {
          type: 'rejected',
          opId: message.opId,
          reason: 'Too many changes at once. Try that again.',
        });
      }
      return;
    }

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
  private apply(op: BoardOp, actor: Actor, opId: string, except: WebSocket[]) {
    if (!this.board) {
      throw new OpError('This board has expired');
    }
    // Decided before the reduce, while a deleted card is still there.
    const secret = this.anonymousTarget(this.board, op, actor);
    const at = Date.now();
    const before = this.board;
    const next = reduce(before, op, actor, at);
    this.board = next;
    this.seq += 1;
    this.persist();

    // The author's own sockets learn which anonymous item is theirs; every
    // other socket gets an echo that names no one.
    const own: OpActor = { id: actor.id, name: actor.name, ...secret };
    const others: OpActor = secret
      ? { id: '', name: '', ...secret }
      : { id: actor.id, name: actor.name };
    const skip = new Set(except);
    for (const ws of this.ctx.getWebSockets()) {
      if (skip.has(ws)) {
        continue;
      }
      const to = ws.deserializeAttachment() as Attachment | null;
      const visible = to?.id === actor.id ? own : others;
      this.send(ws, {
        type: 'op',
        seq: this.seq,
        op: redactHiddenOp(next, op, { id: to?.id ?? '' }),
        opId,
        actor: visible,
        at,
      });
    }

    // The blur lifted (or came back): echoes cannot carry the text everyone
    // can now read, so everyone gets the board again.
    if (blursCards(before) !== blursCards(next)) {
      for (const ws of this.ctx.getWebSockets()) {
        const to = ws.deserializeAttachment() as Attachment | null;
        if (to && !skip.has(ws)) {
          this.sendSnapshot(ws, this.actorFor(to));
        }
      }
    }
  }

  /**
   * If `op` is an anonymous author acting on their own anonymous card or
   * comment, the item that must stand in for them on the echo; else null.
   * Votes and reactions are by participant and public, so they never hide.
   */
  private anonymousTarget(
    board: Board,
    op: BoardOp,
    actor: Actor,
  ): Pick<OpActor, 'anonymousCardIds' | 'anonymousCommentIds'> | null {
    switch (op.type) {
      case 'addCard':
        return op.anonymous ? { anonymousCardIds: [op.id] } : null;
      case 'editCard':
      case 'deleteCard':
      case 'moveCard':
      case 'groupCards':
      case 'ungroupCard': {
        const card = board.cards.find((c) => c.id === op.id);
        return card?.anonymous && card.authorId === actor.id
          ? { anonymousCardIds: [card.id] }
          : null;
      }
      case 'addComment':
        return op.anonymous ? { anonymousCommentIds: [op.id] } : null;
      case 'editComment':
      case 'deleteComment': {
        const comment = board.comments.find((c) => c.id === op.id);
        return comment?.anonymous && comment.authorId === actor.id
          ? { anonymousCommentIds: [comment.id] }
          : null;
      }
      default:
        return null;
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
    // Author ids of anonymous items never leave the object; the recipient's
    // own are listed in `you` instead. Nor does the text of cards still
    // blurred for the recipient.
    const board = redactAnonymous(
      redactHidden(this.withPresence(this.board), actor),
    );
    const you: You = {
      id: actor.id,
      name: actor.name,
      isOwner: actor.isOwner,
      ...anonymousIdsFor(this.board, actor.id),
    };
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
