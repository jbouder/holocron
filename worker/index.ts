import { z } from 'zod';
import { generateCode, isValidCode, normalizeCode } from '#shared/codes';
import { LIMITS } from '#shared/limits';
import type { AppConfig, CreateBoardResponse } from '#shared/protocol';
import { formatResetTime, nextResetAt } from '#shared/reset-time';
import { DEFAULT_TEMPLATE_ID } from '#shared/templates';
import type { Bindings } from './env';
import { turnstileSiteKey, verifyTurnstile } from './turnstile';

export { BoardObject } from './board';

/**
 * The Worker only routes. Static assets are served before it runs (except
 * for /api and /ws, see wrangler.jsonc), and every board lives in its own
 * Durable Object.
 */

const CreateSchema = z.object({
  title: z.string().trim().max(LIMITS.titleMax).default(''),
  templateId: z.string().max(40).default(DEFAULT_TEMPLATE_ID),
  participantId: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(LIMITS.nameMax),
  /** Only checked when Turnstile is configured (see ./turnstile.ts). */
  turnstileToken: z.string().optional(),
});

const CODE_ATTEMPTS = 5;

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    try {
      if (pathname === '/api/boards' && request.method === 'POST') {
        return await createBoard(request, env);
      }

      if (pathname === '/api/config' && request.method === 'GET') {
        const config: AppConfig = {
          resetTimeZone: env.RESET_TZ,
          resetHour: Number(env.RESET_HOUR) || 6,
          resetLabel: formatResetTime(expiryFor(Date.now(), env), env.RESET_TZ),
          turnstileSiteKey: turnstileSiteKey(env),
        };
        return json(config);
      }

      const boardMatch = pathname.match(
        /^\/api\/boards\/([^/]+)(\/export\.md)?$/,
      );
      if (boardMatch) {
        const code = normalizeCode(decodeURIComponent(boardMatch[1]));
        if (!isValidCode(code)) {
          return json({ error: 'That is not a board code' }, 400);
        }
        const stub = env.BOARD.getByName(code);

        if (boardMatch[2]) {
          if (request.method !== 'GET') {
            return json({ error: 'Method not allowed' }, 405);
          }
          const markdown = await stub.exportMarkdown();
          if (markdown === null) {
            return json(
              { error: 'This board has expired or never existed' },
              404,
            );
          }
          return new Response(markdown, {
            headers: {
              'content-type': 'text/markdown; charset=utf-8',
              'content-disposition': `attachment; filename="retro-${code}.md"`,
              'cache-control': 'no-store',
            },
          });
        }

        if (request.method === 'GET') {
          const meta = await stub.meta();
          return meta
            ? json(meta)
            : json({ error: 'This board has expired or never existed' }, 404);
        }

        if (request.method === 'DELETE') {
          const auth = request.headers.get('authorization') ?? '';
          const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
          if (!token) {
            return json({ error: 'Missing owner token' }, 401);
          }
          const result = await stub.destroy(token);
          if (result === 'ok') {
            return new Response(null, { status: 204 });
          }
          if (result === 'forbidden') {
            return json({ error: 'Only the board owner can delete it' }, 403);
          }
          return json(
            { error: 'This board has expired or never existed' },
            404,
          );
        }

        return json({ error: 'Method not allowed' }, 405);
      }

      const wsMatch = pathname.match(/^\/ws\/([^/]+)$/);
      if (wsMatch) {
        if (request.headers.get('Upgrade') !== 'websocket') {
          return new Response('Expected a WebSocket upgrade', { status: 426 });
        }
        const code = normalizeCode(decodeURIComponent(wsMatch[1]));
        if (!isValidCode(code)) {
          return new Response('That is not a board code', { status: 400 });
        }
        // Upgrades must travel as a fetch; RPC cannot carry a socket.
        return env.BOARD.getByName(code).fetch(request);
      }

      return json({ error: 'Not found' }, 404);
    } catch (error) {
      console.error(
        JSON.stringify({
          level: 'error',
          path: pathname,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return json({ error: 'Something went wrong' }, 500);
    }
  },
} satisfies ExportedHandler<Bindings>;

async function createBoard(request: Request, env: Bindings): Promise<Response> {
  const ip = request.headers.get('cf-connecting-ip') ?? 'local';
  const { success } = await env.CREATE_LIMITER.limit({ key: ip });
  if (!success) {
    return json(
      { error: 'Too many boards created from here. Try again in a minute.' },
      429,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Expected JSON' }, 400);
  }
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: 'Invalid board details', issues: parsed.error.issues },
      400,
    );
  }
  const input = parsed.data;

  if (turnstileSiteKey(env)) {
    const check = await verifyTurnstile(input.turnstileToken, request, env);
    if (!check.ok) {
      return json({ error: check.error }, check.status);
    }
  }

  const now = Date.now();
  const expiresAt = expiryFor(now, env);

  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
    const code = generateCode();
    const ownerToken = await env.BOARD.getByName(code).create({
      code,
      title: input.title,
      templateId: input.templateId,
      ownerId: input.participantId,
      ownerName: input.name,
      expiresAt,
    });
    if (ownerToken !== null) {
      const response: CreateBoardResponse = { code, ownerToken, expiresAt };
      return json(response, 201);
    }
  }
  return json({ error: 'Could not find a free board code. Try again.' }, 503);
}

/** The next daily reset, or a short dev TTL when .dev.vars asks for one. */
export function expiryFor(now: number, env: Bindings): number {
  const ttl = Number(env.DEV_BOARD_TTL_SECONDS);
  if (Number.isFinite(ttl) && ttl > 0) {
    return now + ttl * 1000;
  }
  const hour = Number(env.RESET_HOUR);
  return nextResetAt(now, env.RESET_TZ, Number.isInteger(hour) ? hour : 6);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
