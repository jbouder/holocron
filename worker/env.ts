import type { BoardObject } from './board';

/**
 * `wrangler types` writes the global `Env` from wrangler.jsonc, but it cannot
 * know the Durable Object's class or the optional dev-only variable.
 */
export interface Bindings extends Omit<Env, 'BOARD'> {
  BOARD: DurableObjectNamespace<BoardObject>;
  /** Set in .dev.vars to make boards expire quickly while developing. */
  DEV_BOARD_TTL_SECONDS?: string;
}
