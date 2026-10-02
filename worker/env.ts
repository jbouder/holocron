import type { BoardObject } from './board';

/**
 * `wrangler types` writes the global `Env` from wrangler.jsonc, but it cannot
 * know the Durable Object's class, the optional dev-only variable, or that
 * the Turnstile var is any string (it is generated as the literal "").
 */
export interface Bindings
  extends Omit<Env, 'BOARD' | 'TURNSTILE_SITE_KEY' | 'TURNSTILE_SECRET_KEY'> {
  BOARD: DurableObjectNamespace<BoardObject>;
  /** Set in .dev.vars to make boards expire quickly while developing. */
  DEV_BOARD_TTL_SECONDS?: string;
  /** Public Turnstile site key (a var). Empty or unset: Turnstile is off. */
  TURNSTILE_SITE_KEY?: string;
  /** Turnstile secret (`wrangler secret put`). Needed with the site key. */
  TURNSTILE_SECRET_KEY?: string;
}
