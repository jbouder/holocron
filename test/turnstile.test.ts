import { env } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '#shared/protocol';
import type { Bindings } from '../worker/env';
import worker from '../worker/index';

/**
 * The optional Turnstile check on board creation. Siteverify is stubbed by
 * spying on the global fetch the Worker calls.
 */

const base = env as unknown as Bindings;
const enabled: Bindings = {
  ...base,
  TURNSTILE_SITE_KEY: 'site-key',
  TURNSTILE_SECRET_KEY: 'secret-key',
};

let ip = 0;

function create(bindings: Bindings, extra: Record<string, unknown> = {}) {
  // A fresh client IP per request keeps CREATE_LIMITER out of the way.
  ip += 1;
  return worker.fetch(
    new Request('https://retro.example/api/boards', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'cf-connecting-ip': `203.0.113.${ip}`,
      },
      body: JSON.stringify({
        participantId: 'owner-1',
        name: 'Leia',
        ...extra,
      }),
    }) as Request<unknown, IncomingRequestCfProperties>,
    bindings,
  );
}

async function config(bindings: Bindings): Promise<AppConfig> {
  const response = await worker.fetch(
    new Request('https://retro.example/api/config') as Request<
      unknown,
      IncomingRequestCfProperties
    >,
    bindings,
  );
  return response.json();
}

// A fresh Response per call: a body can only be read once, so a shared one
// would make every Siteverify call after the first fail closed.
function stubSiteverify(body: unknown, status = 200) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => Response.json(body, { status }));
}

const PASS = {
  success: true,
  hostname: 'retro.example',
  action: 'create-board',
  'error-codes': [],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Turnstile disabled (the default)', () => {
  it('advertises no site key and creates boards without a token', async () => {
    const siteverify = vi.spyOn(globalThis, 'fetch');
    expect((await config(base)).turnstileSiteKey).toBeNull();
    expect((await create(base)).status).toBe(201);
    expect(siteverify).not.toHaveBeenCalled();
  });

  it('stays off with only one of the site key and secret', async () => {
    const siteverify = vi.spyOn(globalThis, 'fetch');
    const keyOnly = { ...base, TURNSTILE_SITE_KEY: 'site-key' };
    const secretOnly = { ...base, TURNSTILE_SECRET_KEY: 'secret-key' };
    expect((await config(keyOnly)).turnstileSiteKey).toBeNull();
    expect((await create(keyOnly)).status).toBe(201);
    expect((await create(secretOnly)).status).toBe(201);
    expect(siteverify).not.toHaveBeenCalled();
  });
});

describe('Turnstile enabled', () => {
  it('advertises the site key', async () => {
    expect((await config(enabled)).turnstileSiteKey).toBe('site-key');
  });

  it('rejects a missing token without calling Siteverify', async () => {
    const siteverify = vi.spyOn(globalThis, 'fetch');
    const response = await create(enabled);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/human check/),
    });
    expect(siteverify).not.toHaveBeenCalled();
  });

  it('creates the board when Siteverify accepts the token', async () => {
    const siteverify = stubSiteverify(PASS);
    const response = await create(enabled, { turnstileToken: 'good-token' });
    expect(response.status).toBe(201);

    const [url, init] = siteverify.mock.calls[0];
    expect(String(url)).toBe(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    );
    const sent = new URLSearchParams(String(init?.body));
    expect(sent.get('secret')).toBe('secret-key');
    expect(sent.get('response')).toBe('good-token');
    expect(sent.get('remoteip')).toBe(`203.0.113.${ip}`);
  });

  it('rejects a token Siteverify refuses', async () => {
    stubSiteverify({
      success: false,
      'error-codes': ['invalid-input-response'],
    });
    const response = await create(enabled, { turnstileToken: 'bad-token' });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/human check/),
    });
  });

  it('rejects a token issued for another action or hostname', async () => {
    stubSiteverify({ ...PASS, action: 'login' });
    expect((await create(enabled, { turnstileToken: 't' })).status).toBe(403);
    vi.restoreAllMocks();
    stubSiteverify({ ...PASS, hostname: 'evil.example' });
    expect((await create(enabled, { turnstileToken: 't' })).status).toBe(403);
  });

  it('accepts results from Cloudflare test keys', async () => {
    stubSiteverify({
      success: true,
      hostname: 'example.com',
      'error-codes': [],
      metadata: { result_with_testing_key: true },
    });
    expect((await create(enabled, { turnstileToken: 't' })).status).toBe(201);
  });

  it('fails closed when Siteverify is down', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stubSiteverify({}, 502);
    expect((await create(enabled, { turnstileToken: 't' })).status).toBe(503);
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network'));
    expect((await create(enabled, { turnstileToken: 't' })).status).toBe(503);
  });

  it('keeps the IP rate limit in front of the check', async () => {
    const siteverify = stubSiteverify(PASS);
    const request = () =>
      worker.fetch(
        new Request('https://retro.example/api/boards', {
          method: 'POST',
          headers: { 'cf-connecting-ip': '198.51.100.7' },
          body: JSON.stringify({
            participantId: 'p',
            name: 'Han',
            turnstileToken: 't',
          }),
        }) as Request<unknown, IncomingRequestCfProperties>,
        enabled,
      );
    // CREATE_LIMITER allows 10 per minute (wrangler.jsonc). The local limiter
    // counts in windows aligned to the wall clock, so a run that straddles a
    // minute boundary splits its requests across two windows. Sending twice
    // the limit plus one guarantees one window overflows wherever the
    // boundary falls.
    const limit = 10;
    const statuses: number[] = [];
    for (let i = 0; i < 2 * limit + 1; i++) {
      statuses.push((await request()).status);
    }
    expect(statuses).toContain(429);
    // Requests turned away by the limiter never reach Siteverify.
    expect(siteverify.mock.calls.length).toBe(
      statuses.filter((s) => s !== 429).length,
    );
  });

  it('leaves joining a board alone', async () => {
    const siteverify = vi.spyOn(globalThis, 'fetch');
    const response = await worker.fetch(
      new Request('https://retro.example/api/boards/ABCDEF') as Request<
        unknown,
        IncomingRequestCfProperties
      >,
      enabled,
    );
    expect(response.status).toBe(404);
    expect(siteverify).not.toHaveBeenCalled();
  });
});
