import {
  createExecutionContext,
  env,
  runDurableObjectAlarm,
  runInDurableObject,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { CreateBoardResponse } from '#shared/protocol';
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

async function createBoard(overrides: Record<string, unknown> = {}) {
  const response = await call(
    new Request('http://holocron.test/api/boards', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
