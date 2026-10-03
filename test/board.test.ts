import {
  createExecutionContext,
  env,
  runDurableObjectAlarm,
  runInDurableObject,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { LIMITS } from '#shared/limits';
import type { CreateBoardResponse, Op, ServerMessage } from '#shared/protocol';
import { reduce } from '#shared/reducer';
import type { Board } from '#shared/types';
import type { BoardObject } from '../worker/board';
import type { Bindings } from '../worker/env';
import worker from '../worker/index';

const bindings = env as unknown as Bindings;

async function call(request: Request): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    request as Request<unknown, IncomingRequestCfProperties>,
    bindings,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

let ip = 0;

async function createBoard(overrides: Record<string, unknown> = {}) {
  // A fresh client IP per board keeps CREATE_LIMITER (10/min/IP) out of the way.
  ip += 1;
  const response = await call(
    new Request('http://holocron.test/api/boards', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'cf-connecting-ip': `192.0.2.${ip}`,
      },
      body: JSON.stringify({
        title: 'Sprint 42',
        templateId: 'classic',
        participantId: 'owner-1',
        secret: 'secret-of-owner-1',
        name: 'Leia',
        ...overrides,
      }),
    }),
  );
  expect(response.status).toBe(201);
  return (await response.json()) as CreateBoardResponse;
}

function stubFor(code: string): DurableObjectStub<BoardObject> {
  return bindings.BOARD.getByName(code);
}

describe('board lifecycle over HTTP', () => {
  it('creates a board with a six-character code and a future expiry', async () => {
    const created = await createBoard();
    expect(created.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    expect(created.ownerToken).toHaveLength(64);
    expect(created.expiresAt).toBeGreaterThan(Date.now());

    const meta = await call(
      new Request(`http://holocron.test/api/boards/${created.code}`),
    );
    expect(meta.status).toBe(200);
    expect(await meta.json()).toMatchObject({
      code: created.code,
      title: 'Sprint 42',
      expiresAt: created.expiresAt,
      cards: 0,
    });
  });

  it('rejects bad input and unknown codes', async () => {
    const bad = await call(
      new Request('http://holocron.test/api/boards', {
        method: 'POST',
        body: JSON.stringify({ name: '' }),
      }),
    );
    expect(bad.status).toBe(400);

    const missing = await call(
      new Request('http://holocron.test/api/boards/ZZZZZZ'),
    );
    expect(missing.status).toBe(404);

    const invalid = await call(
      new Request('http://holocron.test/api/boards/not-a-code'),
    );
    expect(invalid.status).toBe(400);
  });

  it('accepts lower-case and spaced codes', async () => {
    const created = await createBoard();
    const spaced = `${created.code.slice(0, 3).toLowerCase()} ${created.code.slice(3)}`;
    const meta = await call(
      new Request(
        `http://holocron.test/api/boards/${encodeURIComponent(spaced)}`,
      ),
    );
    expect(meta.status).toBe(200);
  });

  it('only deletes with the owner token', async () => {
    const created = await createBoard();
    const url = `http://holocron.test/api/boards/${created.code}`;

    expect((await call(new Request(url, { method: 'DELETE' }))).status).toBe(
      401,
    );
    expect(
      (
        await call(
          new Request(url, {
            method: 'DELETE',
            headers: { authorization: 'Bearer nope' },
          }),
        )
      ).status,
    ).toBe(403);

    const ok = await call(
      new Request(url, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${created.ownerToken}` },
      }),
    );
    expect(ok.status).toBe(204);
    expect((await call(new Request(url))).status).toBe(404);

    // Nothing left in storage.
    await runInDurableObject(
      stubFor(created.code),
      async (_instance, state) => {
        const tables = state.storage.sql
          .exec<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'board'",
          )
          .toArray();
        expect(tables).toHaveLength(0);
        expect(await state.storage.getAlarm()).toBeNull();
      },
    );
  });

  it('exports Markdown', async () => {
    const created = await createBoard({ title: 'Export me' });
    const response = await call(
      new Request(`http://holocron.test/api/boards/${created.code}/export.md`),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/markdown');
    expect(await response.text()).toContain('# Export me');
  });

  it('exports CSV and a plain-text summary, and 404s other formats', async () => {
    const created = await createBoard({ title: 'Export me' });
    const base = `http://holocron.test/api/boards/${created.code}`;

    const csv = await call(new Request(`${base}/export.csv`));
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(csv.headers.get('content-disposition')).toContain(
      `retro-${created.code}.csv`,
    );
    expect(await csv.text()).toBe('Summary,Owner,Done,Card\r\n');

    const txt = await call(new Request(`${base}/export.txt`));
    expect(txt.status).toBe(200);
    expect(txt.headers.get('content-type')).toContain('text/plain');
    expect(await txt.text()).toContain('Export me · retro ');

    expect((await call(new Request(`${base}/export.pdf`))).status).toBe(404);
    expect(
      (await call(new Request(`${base}/export.csv`, { method: 'POST' })))
        .status,
    ).toBe(405);
  });
});

describe('the daily wipe', () => {
  it('schedules an alarm at the expiry and wipes when it fires', async () => {
    const created = await createBoard();
    const stub = stubFor(created.code);

    await runInDurableObject(stub, async (_instance, state) => {
      expect(await state.storage.getAlarm()).toBe(created.expiresAt);
      const row = state.storage.sql
        .exec<{ json: string }>('SELECT json FROM board WHERE id = 1')
        .one();
      expect(JSON.parse(row.json).title).toBe('Sprint 42');
    });

    expect(await runDurableObjectAlarm(stub)).toBe(true);

    expect(await stub.meta()).toBeNull();
    await runInDurableObject(stub, async (_instance, state) => {
      expect(await state.storage.getAlarm()).toBeNull();
      const tables = state.storage.sql
        .exec<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table'",
        )
        .toArray()
        .map((t) => t.name)
        .filter((n) => !n.startsWith('_cf') && !n.startsWith('sqlite_'));
      expect(tables).toEqual([]);
    });

    // The code is free again afterwards.
    const token = await stub.create({
      code: created.code,
      title: 'Again',
      templateId: 'blank',
      ownerId: 'o2',
      ownerSecret: 'secret',
      ownerName: 'Lando',
      expiresAt: Date.now() + 60_000,
    });
    expect(token).not.toBeNull();
  });

  it('treats a board past its expiry as gone even without the alarm', async () => {
    const created = await createBoard();
    const stub = stubFor(created.code);
    await runInDurableObject(stub, async (instance) => {
      // Reach into the loaded document and backdate the expiry.
      const self = instance as unknown as {
        board: { expiresAt: number } | null;
      };
      if (self.board) {
        self.board.expiresAt = Date.now() - 1;
      }
    });
    expect(await stub.meta()).toBeNull();
  });

  it('refuses to create over a live board', async () => {
    const created = await createBoard();
    const again = await stubFor(created.code).create({
      code: created.code,
      title: 'Clash',
      templateId: 'blank',
      ownerId: 'x',
      ownerSecret: 'secret',
      ownerName: 'X',
      expiresAt: Date.now() + 60_000,
    });
    expect(again).toBeNull();
  });
});

/* ---------- live sockets ---------- */

interface Client {
  ws: WebSocket;
  messages: ServerMessage[];
  /** Resolves with the next message of this type (or one already received). */
  next<T extends ServerMessage['type']>(
    type: T,
    after?: number,
  ): Promise<Extract<ServerMessage, { type: T }>>;
  send(op: Op): string;
}

/** Open a participant's socket straight against the object and buffer it. */
async function join(
  code: string,
  pid: string,
  name: string,
  token?: string,
  secret = `secret-of-${pid}`,
): Promise<Client> {
  const url = new URL(`http://holocron.test/ws/${code}`);
  url.searchParams.set('pid', pid);
  url.searchParams.set('secret', secret);
  url.searchParams.set('name', name);
  if (token) {
    url.searchParams.set('token', token);
  }
  const response = await stubFor(code).fetch(url, {
    headers: { Upgrade: 'websocket' },
  });
  expect(response.status).toBe(101);
  const ws = response.webSocket as WebSocket;
  ws.accept();
  const messages: ServerMessage[] = [];
  // Waiters stay registered until their own message shows up.
  const waiters = new Set<() => void>();
  ws.addEventListener('message', (event) => {
    messages.push(JSON.parse(String(event.data)) as ServerMessage);
    for (const wake of [...waiters]) {
      wake();
    }
  });
  return {
    ws,
    messages,
    next(type, after = 0) {
      return new Promise((resolve, reject) => {
        const check = () => {
          const found = messages
            .slice(after)
            .find(
              (m): m is Extract<ServerMessage, { type: typeof type }> =>
                m.type === type,
            );
          if (!found) {
            return false;
          }
          clearTimeout(timer);
          waiters.delete(check);
          resolve(found);
          return true;
        };
        const timer = setTimeout(() => {
          waiters.delete(check);
          reject(new Error(`no ${type} within 2s`));
        }, 2_000);
        if (!check()) {
          waiters.add(check);
        }
      });
    },
    send(op) {
      const opId = crypto.randomUUID();
      ws.send(JSON.stringify({ type: 'op', opId, op }));
      return opId;
    },
  };
}

describe('anonymity on the wire', () => {
  it('never tells other participants who wrote an anonymous card', async () => {
    const created = await createBoard();
    const han = await join(created.code, 'han', 'Han');
    await han.next('snapshot');

    const addCard = han.send({
      type: 'addCard',
      id: 'secret',
      columnId: 'col-1',
      text: 'I broke prod',
      anonymous: true,
    });
    const hanEcho = await han.next('op');
    expect(hanEcho.opId).toBe(addCard);
    // The author's own echo names them, and marks the card as theirs.
    expect(hanEcho.actor).toEqual({
      id: 'han',
      name: 'Han',
      anonymousCardIds: ['secret'],
    });
    // A signed card to comment on: the anonymous one is sealed until Write
    // ends (see "sealed anonymous cards").
    han.send({
      type: 'addCard',
      id: 'public',
      columnId: 'col-1',
      text: 'Shipped late',
      anonymous: false,
    });
    await han.next('op', han.messages.indexOf(hanEcho) + 1);

    // Luke joins afterwards: the snapshot carries no author id.
    const luke = await join(created.code, 'luke', 'Luke');
    const snapshot = await luke.next('snapshot');
    expect(snapshot.board.cards.find((c) => c.id === 'secret')).toMatchObject({
      authorId: '',
      anonymous: true,
      authorName: '',
    });
    expect(snapshot.you).toMatchObject({
      anonymousCardIds: [],
      anonymousCommentIds: [],
    });

    // Han edits, moves and comments on it: Luke's echoes name nobody.
    const before = luke.messages.length;
    han.send({ type: 'editCard', id: 'secret', text: 'I broke prod twice' });
    han.send({ type: 'moveCard', id: 'secret', columnId: 'col-2' });
    han.send({
      type: 'addComment',
      id: 'whisper',
      cardId: 'public',
      text: 'sorry',
      anonymous: true,
    });
    const opsSince = () =>
      luke.messages
        .slice(before)
        .filter(
          (m): m is Extract<ServerMessage, { type: 'op' }> => m.type === 'op',
        );
    await vi.waitFor(() => expect(opsSince()).toHaveLength(3));
    const echoes = opsSince();
    expect(echoes.map((m) => m.op.type)).toEqual([
      'editCard',
      'moveCard',
      'addComment',
    ]);
    expect(echoes[0].actor).toEqual({
      id: '',
      name: '',
      anonymousCardIds: ['secret'],
    });
    expect(echoes[1].actor).toEqual({
      id: '',
      name: '',
      anonymousCardIds: ['secret'],
    });
    expect(echoes[2].actor).toEqual({
      id: '',
      name: '',
      anonymousCommentIds: ['whisper'],
    });
    // Han is on the participants list, but never as an author or actor.
    for (const m of luke.messages) {
      if (m.type === 'op') {
        expect(m.actor.id).not.toBe('han');
      }
      if (m.type === 'snapshot') {
        const anonymous = m.board.cards.filter((c) => c.anonymous);
        expect(anonymous.map((c) => c.authorId)).not.toContain('han');
        expect(m.board.comments.map((c) => c.authorId)).not.toContain('han');
      }
    }

    // Han's own resync lists both as theirs; the owner's lists neither.
    han.ws.send(JSON.stringify({ type: 'sync' }));
    const resync = await han.next('snapshot', 1);
    expect(resync.you.anonymousCardIds).toEqual(['secret']);
    expect(resync.you.anonymousCommentIds).toEqual(['whisper']);
    const leia = await join(
      created.code,
      'owner-1',
      'Leia',
      created.ownerToken,
    );
    const owner = await leia.next('snapshot');
    expect(owner.you.isOwner).toBe(true);
    expect(owner.you.anonymousCardIds).toEqual([]);
    expect(owner.board.comments[0].authorId).toBe('');

    // Signed cards still carry their author, and the owner still cannot
    // edit someone else's text.
    han.send({
      type: 'addCard',
      id: 'signed',
      columnId: 'col-1',
      text: 'Shipped it',
      anonymous: false,
    });
    const signed = await luke.next('op', luke.messages.length);
    expect(signed.actor).toEqual({ id: 'han', name: 'Han' });
    const rejectedId = leia.send({
      type: 'editCard',
      id: 'signed',
      text: 'no',
    });
    const rejected = await leia.next('rejected');
    expect(rejected.opId).toBe(rejectedId);
  });

  it('keeps the owner able to delete an anonymous card', async () => {
    const created = await createBoard();
    const han = await join(created.code, 'han', 'Han');
    await han.next('snapshot');
    han.send({
      type: 'addCard',
      id: 'secret',
      columnId: 'col-1',
      text: 'x',
      anonymous: true,
    });
    await han.next('op');
    const leia = await join(
      created.code,
      'owner-1',
      'Leia',
      created.ownerToken,
    );
    await leia.next('snapshot');
    const before = han.messages.length;
    leia.send({ type: 'deleteCard', id: 'secret' });
    const echo = await han.next('op', before);
    expect(echo.op).toEqual({ type: 'deleteCard', id: 'secret' });
    expect(echo.actor).toEqual({ id: 'owner-1', name: 'Leia' });
  });
});

describe('flood limit', () => {
  it('refuses ops over the per-second limit instead of dropping them', async () => {
    const created = await createBoard();
    const client = await join(created.code, 'flood', 'Flood');
    await client.next('snapshot');
    const sent = 30;
    for (let i = 0; i < sent; i++) {
      client.send({
        type: 'addCard',
        id: `f-${i}`,
        columnId: 'col-1',
        text: `flood ${i}`,
        anonymous: false,
      });
    }
    // Every op is answered, one way or the other.
    await vi.waitFor(() => {
      const answered = client.messages.filter(
        (m) => m.type === 'op' || m.type === 'rejected',
      ).length;
      expect(answered).toBe(sent);
    });
    const applied = client.messages.filter((m) => m.type === 'op').length;
    const refused = client.messages.filter((m) => m.type === 'rejected');
    expect(applied).toBe(LIMITS.opsPerSecond);
    expect(refused).toHaveLength(sent - LIMITS.opsPerSecond);
    expect(refused[0]).toMatchObject({
      reason: expect.stringMatching(/Too many changes/),
    });
    expect((await stubFor(created.code).meta())?.cards).toBe(
      LIMITS.opsPerSecond,
    );
  });
});

describe('storage hygiene', () => {
  it('leaves no table behind when a code that was never created is probed', async () => {
    const code = 'QQQQQQ';
    expect(
      (await call(new Request(`http://holocron.test/api/boards/${code}`)))
        .status,
    ).toBe(404);
    expect(
      (
        await call(
          new Request(`http://holocron.test/api/boards/${code}/export.md`),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await call(
          new Request(`http://holocron.test/api/boards/${code}/export.csv`),
        )
      ).status,
    ).toBe(404);
    await runInDurableObject(stubFor(code), async (_instance, state) => {
      const tables = state.storage.sql
        .exec<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table'",
        )
        .toArray()
        .map((t) => t.name)
        .filter((n) => !n.startsWith('_cf') && !n.startsWith('sqlite_'));
      expect(tables).toEqual([]);
    });
  });
});

describe('participant identity', () => {
  it('binds an id to the first secret and refuses other browsers using it', async () => {
    const created = await createBoard();
    const han = await join(created.code, 'han', 'Han');
    await han.next('snapshot');
    han.send({
      type: 'addCard',
      id: 'secret',
      columnId: 'col-1',
      text: 'x',
      anonymous: true,
    });
    await han.next('op');

    // Luke has read the snapshot and tries Han's id with his own secret.
    const closed = new Promise<CloseEvent>((resolve) => {
      join(created.code, 'han', 'Luke', undefined, 'secret-of-luke').then((c) =>
        c.ws.addEventListener('close', resolve),
      );
    });
    const event = await closed;
    expect(event.code).toBe(1008);
    expect(event.reason).toBe('identity');

    // Nothing leaked and nothing changed: Han is still Han.
    const watcher = await join(created.code, 'watch', 'Watcher');
    const snapshot = await watcher.next('snapshot');
    expect(snapshot.board.participants.find((p) => p.id === 'han')?.name).toBe(
      'Han',
    );
    expect(snapshot.you.anonymousCardIds).toEqual([]);

    // The same browser (same secret) reconnects fine, from a second tab too.
    const again = await join(created.code, 'han', 'Han');
    const mine = await again.next('snapshot');
    expect(mine.you.anonymousCardIds).toEqual(['secret']);

    // The binding survives a wipe-free restart of the object (reload from
    // storage) and goes away with the board.
    await runInDurableObject(stubFor(created.code), async (_i, state) => {
      expect(await state.storage.get('participantSecrets')).toMatchObject({
        han: expect.any(String),
      });
    });
  });

  it('requires a secret', async () => {
    const created = await createBoard();
    const url = new URL(`http://holocron.test/ws/${created.code}`);
    url.searchParams.set('pid', 'han');
    url.searchParams.set('name', 'Han');
    const response = await stubFor(created.code).fetch(url, {
      headers: { Upgrade: 'websocket' },
    });
    expect(response.status).toBe(400);
  });
});

describe('ownership handoff', () => {
  const base = (code: string) => `http://holocron.test/api/boards/${code}`;

  function startHandoff(code: string, token?: string) {
    return call(
      new Request(`${base(code)}/handoff`, {
        method: 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : {},
      }),
    );
  }

  function redeem(
    code: string,
    handoffCode: string,
    pid = 'han',
    secret = `secret-of-${pid}`,
  ) {
    return call(
      new Request(`${base(code)}/handoff/redeem`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ participantId: pid, secret, code: handoffCode }),
      }),
    );
  }

  async function handoffCode(code: string, token: string) {
    const response = await startHandoff(code, token);
    expect(response.status).toBe(201);
    return (await response.json()) as { code: string; expiresAt: number };
  }

  it('only lets the owner create a code', async () => {
    const created = await createBoard();
    expect((await startHandoff(created.code)).status).toBe(401);
    expect((await startHandoff(created.code, 'nope')).status).toBe(403);

    const handoff = await handoffCode(created.code, created.ownerToken);
    expect(handoff.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    expect(handoff.expiresAt - Date.now()).toBeLessThanOrEqual(
      LIMITS.handoffTtlMs,
    );

    // Only the hash is stored.
    await runInDurableObject(stubFor(created.code), async (_i, state) => {
      const stored = await state.storage.get<{ hash: string }>('handoff');
      expect(stored?.hash).toHaveLength(64);
      expect(JSON.stringify(stored)).not.toContain(handoff.code);
    });
  });

  it('hands ownership over live and rotates the token', async () => {
    const created = await createBoard();
    const leia = await join(
      created.code,
      'owner-1',
      'Leia',
      created.ownerToken,
    );
    const han = await join(created.code, 'han', 'Han');
    expect((await leia.next('snapshot')).you.isOwner).toBe(true);
    expect((await han.next('snapshot')).you.isOwner).toBe(false);

    const { code } = await handoffCode(created.code, created.ownerToken);
    const leiaSeen = leia.messages.length;
    const hanSeen = han.messages.length;
    // Lower-case and spaced, the way people type it.
    const response = await redeem(
      created.code,
      `${code.slice(0, 3).toLowerCase()} ${code.slice(3)}`,
    );
    expect(response.status).toBe(200);
    const { ownerToken } = (await response.json()) as { ownerToken: string };
    expect(ownerToken).toHaveLength(64);
    expect(ownerToken).not.toBe(created.ownerToken);

    // Everyone sees ownerId move; both sockets get a fresh `you`.
    const echo = await han.next('op', hanSeen);
    expect(echo.op).toEqual({ type: 'setOwner', participantId: 'han' });
    expect((await han.next('snapshot', hanSeen)).you.isOwner).toBe(true);
    const leiaNow = await leia.next('snapshot', leiaSeen);
    expect(leiaNow.you.isOwner).toBe(false);
    expect(leiaNow.board.ownerId).toBe('han');

    // The new owner can act as owner on the same socket, the old one cannot.
    const ok = han.send({
      type: 'updateSettings',
      settings: { votesPerPerson: 3 },
    });
    const applied = await han.next('op', hanSeen + 2);
    expect(applied.opId).toBe(ok);
    leia.send({ type: 'updateSettings', settings: { votesPerPerson: 9 } });
    expect((await leia.next('rejected', leiaSeen)).reason).toMatch(/owner/);

    // The old token is dead for sockets and DELETE.
    const stale = await join(
      created.code,
      'owner-1',
      'Leia',
      created.ownerToken,
    );
    expect((await stale.next('snapshot')).you.isOwner).toBe(false);
    const del = await call(
      new Request(base(created.code), {
        method: 'DELETE',
        headers: { authorization: `Bearer ${created.ownerToken}` },
      }),
    );
    expect(del.status).toBe(403);

    // The new token survives a reload of the object and owns the board.
    const fresh = await join(created.code, 'han', 'Han', ownerToken);
    expect((await fresh.next('snapshot')).you.isOwner).toBe(true);
    await runInDurableObject(stubFor(created.code), async (_i, state) => {
      expect(await state.storage.get('handoff')).toBeUndefined();
    });
  });

  it('works once', async () => {
    const created = await createBoard();
    await (await join(created.code, 'han', 'Han')).next('snapshot');
    await (await join(created.code, 'luke', 'Luke')).next('snapshot');
    const { code } = await handoffCode(created.code, created.ownerToken);
    expect((await redeem(created.code, code)).status).toBe(200);
    expect((await redeem(created.code, code, 'luke')).status).toBe(403);
  });

  it('expires, and a new code cancels the old one', async () => {
    const created = await createBoard();
    await (await join(created.code, 'han', 'Han')).next('snapshot');

    const first = await handoffCode(created.code, created.ownerToken);
    const second = await handoffCode(created.code, created.ownerToken);
    expect((await redeem(created.code, first.code)).status).toBe(403);

    // Ten minutes later.
    await runInDurableObject(stubFor(created.code), async (instance) => {
      const pending = (
        instance as unknown as { handoff: { expiresAt: number } }
      ).handoff;
      pending.expiresAt = Date.now() - 1;
    });
    expect((await redeem(created.code, second.code)).status).toBe(403);
  });

  it('needs the redeemer seated and their own browser secret', async () => {
    const created = await createBoard();
    await (await join(created.code, 'han', 'Han')).next('snapshot');
    const { code } = await handoffCode(created.code, created.ownerToken);

    // Someone else brings Han's id with the wrong secret.
    const impostor = await redeem(created.code, code, 'han', 'secret-of-lando');
    expect(impostor.status).toBe(403);
    expect(((await impostor.json()) as { error: string }).error).toMatch(
      /Open this board/,
    );
    // A participant who never joined.
    expect((await redeem(created.code, code, 'ghost')).status).toBe(403);
    // The owner redeeming their own code.
    await (await join(created.code, 'owner-1', 'Leia')).next('snapshot');
    expect((await redeem(created.code, code, 'owner-1')).status).toBe(409);

    // None of that used the code up.
    expect((await redeem(created.code, code)).status).toBe(200);
  });

  it('stops guessing after a few wrong codes', async () => {
    const created = await createBoard();
    await (await join(created.code, 'han', 'Han')).next('snapshot');
    const { code } = await handoffCode(created.code, created.ownerToken);
    const wrong = code === 'AAAAAA' ? 'BBBBBB' : 'AAAAAA';
    for (let i = 0; i < LIMITS.handoffAttemptsPerMinute; i++) {
      expect((await redeem(created.code, wrong)).status).toBe(403);
    }
    // Even the right code waits out the minute.
    expect((await redeem(created.code, code)).status).toBe(429);
  });

  it('rejects malformed codes without asking the board', async () => {
    const created = await createBoard();
    expect((await redeem(created.code, 'nope!')).status).toBe(400);
  });

  it('goes with the wipe', async () => {
    const created = await createBoard();
    await handoffCode(created.code, created.ownerToken);
    await runDurableObjectAlarm(stubFor(created.code));
    await runInDurableObject(stubFor(created.code), async (_i, state) => {
      expect(await state.storage.get('handoff')).toBeUndefined();
    });
  });
});

describe('anonymity across every message', () => {
  it('never puts an anonymous author’s id on anyone else’s wire', async () => {
    const created = await createBoard();
    const leia = await join(
      created.code,
      'owner-1',
      'Leia',
      created.ownerToken,
    );
    const luke = await join(created.code, 'luke', 'Luke');
    const han = await join(created.code, 'han', 'Han');
    await Promise.all([
      leia.next('snapshot'),
      luke.next('snapshot'),
      han.next('snapshot'),
    ]);

    // Every op an anonymous author can take on their own items.
    const card = (id: string): Op => ({
      type: 'addCard',
      id,
      columnId: 'col-1',
      text: `Card ${id}`,
      anonymous: true,
    });
    const writing: Op[] = [
      card('a'),
      card('b'),
      { type: 'editCard', id: 'a', text: 'Edited' },
      { type: 'moveCard', id: 'a', columnId: 'col-2' },
      { type: 'groupCards', id: 'a', targetId: 'b', groupId: 'grp' },
      { type: 'ungroupCard', id: 'a' },
    ];
    // Comments on anonymous cards open once Write ends.
    const commenting: Op[] = [
      {
        type: 'addComment',
        id: 'c',
        cardId: 'b',
        text: 'Mine',
        anonymous: true,
      },
      { type: 'editComment', id: 'c', text: 'Still mine' },
      {
        type: 'addComment',
        id: 'd',
        cardId: 'b',
        text: 'Also mine',
        anonymous: true,
      },
      { type: 'deleteComment', id: 'd' },
      { type: 'deleteCard', id: 'a' },
    ];
    const echoes = (client: Client) =>
      client.messages.filter((m) => m.type === 'op').length;
    for (const op of writing) {
      han.send(op);
    }
    await vi.waitFor(() => expect(echoes(han)).toBe(writing.length));
    leia.send({ type: 'setPhase', phase: 'vote' });
    await vi.waitFor(() => expect(echoes(han)).toBe(writing.length + 1));
    for (const op of commenting) {
      han.send(op);
    }
    const total = writing.length + 1 + commenting.length;
    // Han's join rename is the first echo the others see.
    await vi.waitFor(() => {
      expect(echoes(han)).toBe(total);
      expect(echoes(luke)).toBe(total + 1);
    });
    expect(han.messages.some((m) => m.type === 'rejected')).toBe(false);

    // Fresh snapshots too, for a viewer and for the owner.
    luke.ws.send(JSON.stringify({ type: 'sync' }));
    leia.ws.send(JSON.stringify({ type: 'sync' }));
    await luke.next('snapshot', 1);
    await leia.next('snapshot', 1);

    for (const client of [luke, leia]) {
      for (const m of client.messages) {
        const raw = JSON.stringify(m);
        expect(raw).not.toContain('"authorId":"han"');
        expect(raw).not.toContain('"authorName":"Han"');
        if (m.type === 'op' && !['setName', 'setPhase'].includes(m.op.type)) {
          expect(m.actor).toMatchObject({ id: '', name: '' });
        }
      }
    }

    const md = await call(
      new Request(`http://holocron.test/api/boards/${created.code}/export.md`),
    );
    expect(await md.text()).not.toContain('Han');
  });
});

describe('sealed anonymous cards on the wire', () => {
  it('refuses the author’s reaction instead of broadcasting their id', async () => {
    const created = await createBoard();
    const luke = await join(created.code, 'luke', 'Luke');
    const han = await join(created.code, 'han', 'Han');
    await Promise.all([luke.next('snapshot'), han.next('snapshot')]);
    han.send({
      type: 'addCard',
      id: 'secret',
      columnId: 'col-1',
      text: 'I broke prod',
      anonymous: true,
    });
    await vi.waitFor(() =>
      expect(
        luke.messages.some((m) => m.type === 'op' && m.op.type === 'addCard'),
      ).toBe(true),
    );
    const seen = luke.messages.length;

    const opId = han.send({
      type: 'toggleReaction',
      cardId: 'secret',
      emoji: '👍',
    });
    const rejected = await han.next('rejected');
    expect(rejected.opId).toBe(opId);

    luke.ws.send(JSON.stringify({ type: 'sync' }));
    const snapshot = await luke.next('snapshot', seen);
    expect(snapshot.board.reactions).toEqual([]);
    expect(luke.messages.slice(seen).filter((m) => m.type === 'op')).toEqual(
      [],
    );
  });
});

describe('blurred cards on the wire', () => {
  it('keeps the text off other sockets and the export until Write ends', async () => {
    const created = await createBoard();
    const leia = await join(
      created.code,
      'owner-1',
      'Leia',
      created.ownerToken,
    );
    const luke = await join(created.code, 'luke', 'Luke');
    const han = await join(created.code, 'han', 'Han');
    await Promise.all([
      leia.next('snapshot'),
      luke.next('snapshot'),
      han.next('snapshot'),
    ]);

    han.send({
      type: 'addCard',
      id: 'h',
      columnId: 'col-1',
      text: 'Han private',
      anonymous: false,
    });
    han.send({ type: 'editCard', id: 'h', text: 'Han private, edited' });
    const isCardOp = (m: ServerMessage) =>
      m.type === 'op' && (m.op.type === 'addCard' || m.op.type === 'editCard');
    await vi.waitFor(() => {
      expect(luke.messages.filter(isCardOp)).toHaveLength(2);
      expect(han.messages.filter(isCardOp)).toHaveLength(2);
    });
    // The author's own echo keeps the text.
    expect(JSON.stringify(han.messages)).toContain('Han private, edited');

    luke.ws.send(JSON.stringify({ type: 'sync' }));
    await luke.next('snapshot', 1);
    expect(JSON.stringify(luke.messages)).not.toContain('Han private');
    expect(JSON.stringify(leia.messages)).not.toContain('Han private');

    const md = await call(
      new Request(`http://holocron.test/api/boards/${created.code}/export.md`),
    );
    expect(await md.text()).not.toContain('Han private');

    // Write ends: everyone gets a snapshot with the text.
    const seen = luke.messages.length;
    leia.send({ type: 'setPhase', phase: 'vote' });
    const after = await luke.next('snapshot', seen);
    expect(after.board.phase).toBe('vote');
    expect(after.board.cards[0].text).toBe('Han private, edited');
  });
});

describe('code probing', () => {
  const from = (ip: string, path: string, init: RequestInit = {}) =>
    call(
      new Request(`http://holocron.test${path}`, {
        ...init,
        headers: { 'cf-connecting-ip': ip, ...init.headers },
      }),
    );

  it('limits lookups by code per address, the same for live and unknown codes', async () => {
    const created = await createBoard();
    const ip = '198.51.100.7';
    const statuses: number[] = [];
    // Live board, unknown code and export all draw on one budget.
    for (let i = 0; i < 100; i++) {
      for (const path of [
        `/api/boards/${created.code}`,
        '/api/boards/ZZZZZZ',
        `/api/boards/${created.code}/export.md`,
      ]) {
        statuses.push((await from(ip, path)).status);
      }
    }
    expect(statuses.filter((s) => s === 429)).toHaveLength(0);
    for (const path of [`/api/boards/${created.code}`, '/api/boards/ZZZZZZ']) {
      const refused = await from(ip, path);
      expect(refused.status).toBe(429);
      expect(await refused.json()).toEqual({
        error: 'Too many board lookups from here. Wait a minute.',
      });
    }
    // Someone else is not affected.
    expect(
      (await from('198.51.100.8', `/api/boards/${created.code}`)).status,
    ).toBe(200);
  });

  it('counts delete and handoff against the same budget', async () => {
    const created = await createBoard();
    const ip = '198.51.100.10';
    const probes = [
      ['DELETE', `/api/boards/${created.code}`],
      ['DELETE', '/api/boards/ZZZZZZ'],
      ['POST', `/api/boards/${created.code}/handoff`],
      ['POST', '/api/boards/ZZZZZZ/handoff/redeem'],
    ] as const;
    const statuses: number[] = [];
    for (let i = 0; i < 75; i++) {
      for (const [method, path] of probes) {
        statuses.push(
          (
            await from(ip, path, {
              method,
              headers: {
                authorization: 'Bearer wrong',
                'content-type': 'application/json',
              },
              body: method === 'POST' ? '{}' : undefined,
            })
          ).status,
        );
      }
    }
    // Under the budget the answers still tell live from unknown apart...
    expect(statuses).not.toContain(429);
    expect(new Set(statuses)).toContain(403);
    expect(new Set(statuses)).toContain(404);
    // ...which is why the 301st, whatever it is, is refused.
    for (const [method, path] of probes) {
      const refused = await from(ip, path, {
        method,
        headers: { authorization: 'Bearer wrong' },
      });
      expect(refused.status).toBe(429);
    }
    // The board is still there.
    expect(
      (await from('198.51.100.11', `/api/boards/${created.code}`)).status,
    ).toBe(200);
  });

  it('closes an over-limit socket with 1013 instead of failing the upgrade', async () => {
    const created = await createBoard();
    const ip = '198.51.100.9';
    for (let i = 0; i < 300; i++) {
      await from(ip, '/api/boards/ZZZZZZ');
    }
    const response = await from(
      ip,
      `/ws/${created.code}?pid=p&secret=s&name=N`,
      {
        headers: { Upgrade: 'websocket' },
      },
    );
    expect(response.status).toBe(101);
    const ws = response.webSocket as WebSocket;
    const closed = new Promise<CloseEvent>((resolve) =>
      ws.addEventListener('close', resolve),
    );
    ws.accept();
    const event = await closed;
    expect(event.code).toBe(1013);
    expect(event.reason).toBe('limited');
  });
});

describe('crowded boards', () => {
  /** Resolves with the socket's close event. */
  function closeOf(client: Client): Promise<CloseEvent> {
    return new Promise((resolve) =>
      client.ws.addEventListener('close', resolve),
    );
  }

  /** Seat everyone up to the limit (the owner is already seated). */
  async function fill(code: string): Promise<Client[]> {
    const clients: Client[] = [];
    for (let i = 1; i < LIMITS.participantsMax; i++) {
      const client = await join(code, `p${i}`, `P${i}`);
      await client.next('snapshot');
      clients.push(client);
    }
    return clients;
  }

  it('turns a newcomer away when every seat is held by someone online', async () => {
    const created = await createBoard();
    await fill(created.code);
    const late = await join(created.code, 'late', 'Late');
    const closed = await closeOf(late);
    expect(closed.code).toBe(1008);
    expect(closed.reason).toBe('full');
  });

  it('gives a newcomer the first idle seat, never one with something public', async () => {
    const created = await createBoard();
    const clients = await fill(created.code);
    // p1 signs a card, p2 writes only an anonymous one; then all but the
    // last leave.
    clients[0].send({
      type: 'addCard',
      id: 'signed',
      columnId: 'col-1',
      text: 'Mine',
      anonymous: false,
    });
    clients[1].send({
      type: 'addCard',
      id: 'anon',
      columnId: 'col-1',
      text: 'Secret',
      anonymous: true,
    });
    const watcher = clients[clients.length - 1];
    await vi.waitFor(() =>
      expect(
        watcher.messages.filter(
          (m) => m.type === 'op' && m.op.type === 'addCard',
        ),
      ).toHaveLength(2),
    );
    for (const client of clients.slice(0, -1)) {
      const closed = closeOf(client);
      client.ws.close(1000, 'leaving');
      await closed;
    }

    const seen = watcher.messages.length;
    const late = await join(created.code, 'late', 'Late');
    const snapshot = await late.next('snapshot');
    const ids = snapshot.board.participants.map((p) => p.id);
    expect(ids).toContain('late');
    expect(ids).toContain('p1');
    // p2's anonymous card does not keep the seat: keeping it would say
    // who wrote it.
    expect(ids).not.toContain('p2');
    const release = await watcher.next('op', seen);
    expect(release.op).toEqual({ type: 'releaseSeat', participantId: 'p2' });
    expect(release.actor).toEqual({ id: '', name: '' });

    // p2 still owns the anonymous card when they come back (a seat frees
    // up once someone idle can go).
    const leaving = closeOf(late);
    late.ws.close(1000, 'leaving');
    await leaving;
    const back = await join(created.code, 'p2', 'P2');
    const mine = await back.next('snapshot');
    expect(mine.you.anonymousCardIds).toEqual(['anon']);
  });

  it('lets the newest tab in past the tab cap, replacing the oldest', async () => {
    const created = await createBoard();
    const tabs: Client[] = [];
    for (let i = 0; i < LIMITS.socketsPerParticipant; i++) {
      const tab = await join(created.code, 'han', 'Han');
      await tab.next('snapshot');
      tabs.push(tab);
    }
    // After a network cut the server may still hold every old socket; the
    // reconnecting tab must get in all the same.
    const oldest = closeOf(tabs[0]);
    const extra = await join(created.code, 'han', 'Han');
    const snapshot = await extra.next('snapshot');
    expect(snapshot.you.id).toBe('han');
    const closed = await oldest;
    expect(closed.code).toBe(1008);
    expect(closed.reason).toBe('replaced');

    // Only the oldest went: the others still get echoes.
    const before = tabs[1].messages.length;
    extra.send({
      type: 'addCard',
      id: 'c',
      columnId: 'col-1',
      text: 'Still here',
      anonymous: false,
    });
    await tabs[1].next('op', before);
    await runInDurableObject(
      stubFor(created.code),
      async (_instance, state) => {
        const open = state
          .getWebSockets()
          .filter((ws) => ws.readyState === WebSocket.READY_STATE_OPEN);
        expect(open).toHaveLength(LIMITS.socketsPerParticipant);
      },
    );
  });

  it('replaces nothing for a join it turns away', async () => {
    const created = await createBoard();
    const tabs: Client[] = [];
    for (let i = 0; i < LIMITS.socketsPerParticipant; i++) {
      const tab = await join(created.code, 'han', 'Han');
      await tab.next('snapshot');
      tabs.push(tab);
    }
    // Han's id from another browser is an impostor: Han keeps every tab.
    const impostor = await join(created.code, 'han', 'Han', undefined, 'nope');
    expect((await closeOf(impostor)).reason).toBe('identity');
    const before = tabs[0].messages.length;
    tabs[4].send({
      type: 'addCard',
      id: 'c',
      columnId: 'col-1',
      text: 'Still here',
      anonymous: false,
    });
    await tabs[0].next('op', before);
  });

  it('caps sockets per board, but never shuts the owner out', async () => {
    const created = await createBoard();
    // 24 participants x 5 tabs fill the 120 sockets without filling seats.
    const tabs: Client[] = [];
    for (let i = 0; tabs.length < LIMITS.socketsMax; i++) {
      for (let t = 0; t < LIMITS.socketsPerParticipant; t++) {
        const tab = await join(created.code, `p${i}`, `P${i}`);
        await tab.next('snapshot');
        tabs.push(tab);
      }
    }
    const late = await join(created.code, 'late', 'Late');
    const closed = await closeOf(late);
    expect(closed.code).toBe(1008);
    expect(closed.reason).toBe('full');

    // Someone already in, past their own tab cap, swaps a tab for a tab.
    const swap = await join(created.code, 'p0', 'P0');
    expect((await swap.next('snapshot')).you.id).toBe('p0');

    const owner = await join(
      created.code,
      'owner-1',
      'Leia',
      created.ownerToken,
    );
    const snapshot = await owner.next('snapshot');
    expect(snapshot.you.isOwner).toBe(true);
  });

  it('binds nothing for a join it turns away', async () => {
    const created = await createBoard();
    const clients = await fill(created.code);
    const refused = await join(created.code, 'late', 'Late', undefined, 'one');
    expect((await closeOf(refused)).reason).toBe('full');
    // A seat frees up; the same id from another browser is not an impostor,
    // because the first one never got bound.
    const leaving = closeOf(clients[0]);
    clients[0].ws.close(1000, 'leaving');
    await leaving;
    const other = await join(created.code, 'late', 'Late', undefined, 'two');
    const snapshot = await other.next('snapshot');
    expect(snapshot.you.id).toBe('late');
  });
});

describe('grouping anonymous cards on a locked board', () => {
  it('names no one when either card is the author’s anonymous one, and every other client can replay it', async () => {
    const created = await createBoard();
    const luke = await join(created.code, 'luke', 'Luke');
    const han = await join(created.code, 'han', 'Han');
    await Promise.all([luke.next('snapshot'), han.next('snapshot')]);

    const card = (id: string, anonymous: boolean): Op => ({
      type: 'addCard',
      id,
      columnId: 'col-1',
      text: `Card ${id}`,
      anonymous,
    });
    const ops: Op[] = [
      card('a', true),
      card('b', true),
      card('s', false),
      // anonymous onto anonymous, signed onto anonymous, anonymous onto
      // signed: all Han's, so the lock lets them through.
      { type: 'groupCards', id: 'a', targetId: 'b', groupId: 'g1' },
      { type: 'ungroupCard', id: 'a' },
      { type: 'groupCards', id: 's', targetId: 'b', groupId: 'g2' },
      { type: 'ungroupCard', id: 's' },
      { type: 'groupCards', id: 'a', targetId: 's', groupId: 'g3' },
    ];
    for (const op of ops) {
      han.send(op);
    }
    // Han's join rename is the first echo Luke sees.
    await vi.waitFor(() =>
      expect(luke.messages.filter((m) => m.type === 'op')).toHaveLength(
        ops.length + 1,
      ),
    );
    expect(han.messages.filter((m) => m.type === 'rejected')).toEqual([]);

    // What Luke's browser does: start from the snapshot and reduce each
    // echo with the actor as sent. None may throw (a throw means a resync
    // for everyone else on every drag).
    let board: Board | null = null;
    for (const m of luke.messages) {
      if (m.type === 'snapshot') {
        board = m.board;
        continue;
      }
      if (m.type !== 'op' || !board) {
        continue;
      }
      if (m.op.type === 'groupCards') {
        expect(JSON.stringify(m)).not.toContain('han');
        expect(m.actor).toMatchObject({ id: '', name: '' });
      }
      board = reduce(
        board,
        m.op,
        {
          id: m.actor.id,
          name: m.actor.name,
          isOwner: m.actor.id !== '' && m.actor.id === board.ownerId,
          anonymousCardIds: m.actor.anonymousCardIds,
          anonymousCommentIds: m.actor.anonymousCommentIds,
        },
        m.at,
      );
    }
    const groups = Object.fromEntries(
      (board as Board).cards.map((c) => [c.id, c.groupId]),
    );
    expect(groups).toEqual({ a: 'g3', b: null, s: 'g3' });
  });
});

describe('credential hardening', () => {
  it('binds the creator’s id at creation, before their first socket', async () => {
    const created = await createBoard();
    // Someone who learned the owner's id joins as them first.
    const closed = new Promise<CloseEvent>((resolve) => {
      join(created.code, 'owner-1', 'Leia', undefined, 'not-leias').then((c) =>
        c.ws.addEventListener('close', resolve),
      );
    });
    const event = await closed;
    expect(event.code).toBe(1008);
    expect(event.reason).toBe('identity');
    // The real owner still gets in, as the owner.
    const leia = await join(
      created.code,
      'owner-1',
      'Leia',
      created.ownerToken,
    );
    expect((await leia.next('snapshot')).you.isOwner).toBe(true);
  });

  it('needs the creator’s secret to create a board', async () => {
    const response = await call(
      new Request('http://holocron.test/api/boards', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'cf-connecting-ip': '203.0.113.200',
        },
        body: JSON.stringify({ participantId: 'p', name: 'P' }),
      }),
    );
    expect(response.status).toBe(400);
  });

  it('wipes an overdue board when a socket closes, before saying who left', async () => {
    const created = await createBoard();
    const han = await join(created.code, 'han', 'Han');
    const luke = await join(created.code, 'luke', 'Luke');
    await Promise.all([han.next('snapshot'), luke.next('snapshot')]);
    const stub = stubFor(created.code);
    await runInDurableObject(stub, async (instance) => {
      const self = instance as unknown as {
        board: { expiresAt: number } | null;
      };
      if (self.board) {
        self.board.expiresAt = Date.now() - 1;
      }
    });
    const seen = luke.messages.length;
    han.ws.close(1000, 'leaving');
    await luke.next('expired', seen);
    expect(luke.messages.slice(seen).some((m) => m.type === 'presence')).toBe(
      false,
    );
    expect(await stub.meta()).toBeNull();
  });
});
