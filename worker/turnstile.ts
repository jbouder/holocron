import { TURNSTILE_ACTION } from '#shared/protocol';
import type { Bindings } from './env';

/**
 * Optional Cloudflare Turnstile check on board creation. Off unless both the
 * `TURNSTILE_SITE_KEY` var and the `TURNSTILE_SECRET_KEY` secret are set;
 * with either missing, creation behaves exactly as if Turnstile did not exist.
 */

const SITEVERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TOKEN_MAX = 2048;

/** The site key to hand the browser, or null when Turnstile is off. */
export function turnstileSiteKey(env: Bindings): string | null {
  const siteKey = env.TURNSTILE_SITE_KEY?.trim();
  const secret = env.TURNSTILE_SECRET_KEY?.trim();
  return siteKey && secret ? siteKey : null;
}

export type TurnstileResult =
  | { ok: true }
  | { ok: false; status: 400 | 403 | 503; error: string };

interface SiteverifyResponse {
  success: boolean;
  hostname?: string;
  action?: string;
  'error-codes'?: string[];
  metadata?: { result_with_testing_key?: boolean };
}

/**
 * Redeem a widget token with Siteverify. Fails closed: a missing token, a
 * rejected one, a wrong action or hostname, or Siteverify being unreachable
 * all stop the board from being created.
 */
export async function verifyTurnstile(
  token: string | undefined,
  request: Request,
  env: Bindings,
): Promise<TurnstileResult> {
  if (!token || token.length > TOKEN_MAX) {
    return {
      ok: false,
      status: 400,
      error: 'Complete the human check, then create the board.',
    };
  }

  let result: SiteverifyResponse;
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET_KEY ?? '',
        response: token,
        remoteip: request.headers.get('cf-connecting-ip') ?? '',
      }),
    });
    if (!response.ok) {
      throw new Error(`siteverify ${response.status}`);
    }
    result = (await response.json()) as SiteverifyResponse;
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'turnstile siteverify failed',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return {
      ok: false,
      status: 503,
      error: 'Could not run the human check. Try again in a moment.',
    };
  }

  // The app and the API share an origin, so the page that rendered the
  // widget is on the host this request came to. Cloudflare's test keys
  // answer with a fixed hostname and no action; a test secret accepts every
  // token anyway, so skipping these two checks for it loosens nothing.
  const testing = result.metadata?.result_with_testing_key === true;
  const matches =
    testing ||
    (result.action === TURNSTILE_ACTION &&
      result.hostname === new URL(request.url).hostname);
  if (!result.success || !matches) {
    return {
      ok: false,
      status: 403,
      error: 'The human check did not pass. Try it again.',
    };
  }
  return { ok: true };
}
