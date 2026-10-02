# AGENTS.md — holocron

Guidance for AI agents working in this repository.

## What this is

A shareable retro board. Anyone creates a board, shares a six-character code,
and the team runs the retro live: Write → Vote → Discuss. Every board is wiped
daily (6 AM America/New_York by default). No accounts. Runs entirely on
Cloudflare: a Worker serves the SPA and routes; each board is one SQLite-backed
Durable Object that holds the data, fans out WebSocket updates, and wipes
itself on an alarm.

## Layout

- `shared/` — the domain, used by both sides. `types.ts` (the Board
  document), `protocol.ts` (zod schemas for every op and message),
  `reducer.ts` (**the only place board state changes**, incl. permission
  rules), `templates.ts`, `codes.ts`, `reset-time.ts`, `export.ts`, `limits.ts`.
- `worker/` — `index.ts` routes HTTP + WebSocket upgrades; `board.ts` is the
  `BoardObject` Durable Object; `env.ts` types the bindings.
- `src/` — React 19 + Vite app. `hooks/useBoard.ts` is the live connection
  (optimistic ops over a confirmed snapshot). `components/board/*` is the board
  UI, `pages/*` the four routes, `lib/router.ts` a small pushState router.
- `test/` — Vitest running inside workerd (`@cloudflare/vitest-plugin`).
- `docs/` — self-hosting, architecture, data retention. The in-app Help page
  (`src/pages/HelpPage.tsx`) covers *using* the tool only.

## Stack

React 19 + TypeScript + Vite 7 · Tailwind CSS v4 (CSS-first, `src/index.css`) ·
stock shadcn `base-lyra` on Base UI (`src/components/ui`, CLI-managed, do not
hand-edit) · Phosphor icons · Biome · zod · Cloudflare Workers + Durable Objects
via `@cloudflare/vite-plugin` · **bun** for installs (npm's resolver currently
fails on Vitest 4.1 peers).

## Rules

- **Every change to a board is an op through `reduce()`.** Add the op to
  `protocol.ts`, handle it in `reducer.ts`, test it in `test/reducer.test.ts`.
  Never mutate board state in the DO or the UI directly. Permission checks
  live in the reducer so the UI can never do what the server refuses.
- **The DO persists the whole document** (one JSON row in SQLite) after each
  op and broadcasts the op with a sequence number. Clients resync on a gap.
- **Owner ≠ participant id.** Owner status comes only from the owner token
  (hashed in the DO, sent on the socket URL). Never trust a client-sent id.
- **A participant id is bound to a browser secret.** The DO hashes the
  `secret` query param on the first socket for an id and refuses later
  sockets that bring another one (close 1008 `identity`). Nothing may accept
  a participant id without going through that check.
- **Anonymous means no author id on the wire.** The DO's document keeps the
  real `authorId`; `redactAnonymous()` blanks it on every snapshot, and
  `apply()` blanks the actor on echoes of an anonymous author's own ops.
  The author learns which items are theirs through `you.anonymousCardIds`
  / `anonymousCommentIds`. Use `isCardAuthor` / `isCommentAuthor`, never
  compare `authorId` directly. Anything new that carries a participant id
  must go through the same redaction.
- **The wipe is sacred.** `alarm()` → `wipe()` → `storage.deleteAll()`. Every
  entry point calls `expireIfDue()` first. Do not add anything that survives it.
- **No animation libraries for app motion.** View Transitions, WAAPI,
  `@starting-style`, CSS `linear()` springs. Helpers in `src/lib/motion.ts`,
  `src/hooks/useFlip.ts`. (`tw-animate-css` is imported only because the
  stock shadcn overlays in `src/components/ui/*` use it; do not reach for it.)
  Tokens, not literals (`var(--duration-base)`, `var(--ease-emphasized)`).
  Animate `opacity`/`transform` only; position changes go through FLIP or View
  Transitions. Scope `view-transition-name`s with `html[data-vt="…"]`
  (types in use: `page`, `phase`, `theme`).
- **Motion respects two switches:** Preferences → Motion
  (`html[data-motion="off"]`) and `prefers-reduced-motion` (hard override).
  JS helpers take `enabled` from `useMotion().active`.
- Motion styling belongs in `src/index.css` or at the call site, never in
  `src/components/ui/*`.
- Self-hosting docs live in `docs/`, not in the app.

## Commands

```bash
bun install
npm run dev          # Vite + Worker + DO locally (Miniflare)
npm test             # wrangler types + vitest (runs in workerd)
npm run check        # biome check --write
npm run build        # wrangler types + tsc -b + vite build
npm run deploy       # build + wrangler deploy
```

Run `npm run check && npm run build && npm test` before finishing any change.
Verify UI changes in the browser with two tabs on the same board.
