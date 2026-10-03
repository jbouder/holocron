import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import html from '../index.html?raw';
import headers from '../public/_headers?raw';
import type { Bindings } from '../worker/env';
import worker from '../worker/index';

/** The value of one header in public/_headers (all rules are under /*). */
function header(name: string): string {
  const lines = headers
    .split('\n')
    .filter((l) => l.trim().toLowerCase().startsWith(`${name.toLowerCase()}:`));
  expect(lines, `${name} in public/_headers`).toHaveLength(1);
  const line = lines[0] ?? '';
  return line.slice(line.indexOf(':') + 1).trim();
}

function directive(csp: string, name: string): string[] {
  const found = csp
    .split(';')
    .map((d) => d.trim().split(/\s+/))
    .find(([key]) => key === name);
  expect(found, `${name} in the CSP`).toBeDefined();
  return found?.slice(1) ?? [];
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

describe('static asset headers', () => {
  it('is a well-formed _headers file', () => {
    // Comments, blank lines, one path rule, and `Name: value` lines. Anything
    // else (a stray conflict marker, say) ships to every visitor.
    for (const line of headers.split('\n')) {
      if (line === '' || line.startsWith('#')) continue;
      expect(line, line).toMatch(/^(\/\S*|\s+[A-Za-z-]+: \S.*)$/);
    }
  });

  const csp = header('Content-Security-Policy');

  it('allows every inline script in index.html by hash, and nothing else inline', async () => {
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    expect(inline.length).toBeGreaterThan(0);
    const scriptSrc = directive(csp, 'script-src');
    for (const [, body] of inline) {
      expect(scriptSrc).toContain(`'sha256-${await sha256(body)}'`);
    }
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it('cannot be framed, sniffed or pointed elsewhere', () => {
    expect(directive(csp, 'frame-ancestors')).toEqual(["'none'"]);
    expect(directive(csp, 'object-src')).toEqual(["'none'"]);
    expect(directive(csp, 'base-uri')).toEqual(["'none'"]);
    expect(header('X-Content-Type-Options')).toBe('nosniff');
    expect(header('X-Frame-Options')).toBe('DENY');
    expect(header('Referrer-Policy')).toBe('same-origin');
    expect(header('Permissions-Policy')).toContain('camera=()');
  });

  it('lets the analysis model and Turnstile load', () => {
    expect(directive(csp, 'script-src')).toEqual(
      expect.arrayContaining([
        "'wasm-unsafe-eval'",
        'https://challenges.cloudflare.com',
      ]),
    );
    expect(directive(csp, 'frame-src')).toContain(
      'https://challenges.cloudflare.com',
    );
    expect(directive(csp, 'connect-src')).toEqual(
      expect.arrayContaining([
        "'self'",
        'https://huggingface.co',
        'https://raw.githubusercontent.com',
      ]),
    );
  });
});

describe('Worker response headers', () => {
  it('sends them on JSON, export and error responses', async () => {
    const bindings = env as unknown as Bindings;
    const responses = await Promise.all(
      [
        'http://holocron.test/api/config',
        'http://holocron.test/api/boards/ABCDEF',
        'http://holocron.test/api/nope',
        'http://holocron.test/ws/ABCDEF',
      ].map((url) =>
        worker.fetch(
          new Request(url) as Request<unknown, IncomingRequestCfProperties>,
          bindings,
        ),
      ),
    );
    for (const response of responses) {
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('content-security-policy')).toContain(
        "frame-ancestors 'none'",
      );
    }
  });
});
