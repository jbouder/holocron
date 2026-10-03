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
      cardId: 'secret',
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
        expect(m.board.cards.map((c) => c.authorId)).not.toContain('han');
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
