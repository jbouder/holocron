# Holocron

A retro board for your team that is gone by morning.

Create a board, share the six-character code, and run the retro together:
**Write → Vote → Discuss**. Cards, dot voting, drag-to-group, a shared timer,
action items, Markdown export. No accounts, no history. Every board is wiped
at **6:00 AM Eastern** each day.

Named after the Jedi archive that stores lessons for those who come after.
This one resets at dawn.

Runs entirely on Cloudflare: one Worker serves the app, and each board is a
SQLite-backed Durable Object that holds the data, pushes live updates over
WebSockets, and wipes itself on an alarm.

## Features

- **Boards and codes.** Anyone can create a board. The six-character code (or
  the link, or the QR code in the share dialog) is the only invitation. Six templates: Went well / To improve,
  Start / Stop / Continue, Mad / Sad / Glad, 4Ls, Dagobah, Blank. Columns are
  editable afterwards.
- **Phases.** A stepper moves everyone at once. In *Write*, other people's
  cards are blurred so nobody anchors on the first idea. In *Vote*, each
  person spends a budget of dot votes (default 5, several per card allowed).
  In *Discuss*, columns sort by votes and the action items panel opens.
- **Cards.** Enter posts, Shift+Enter breaks a line. Optional per-card
  anonymity. Edit and delete your own from the `⋯` menu on the card (or
  double-click to edit); the owner can delete any.
- **Grouping.** Drag a card onto another to stack them; groups carry a
  combined vote count. Drag to an empty spot to move between columns.
- **Timer.** 1–15 minute presets, counted down on every screen.
- **Action items.** Text, optional owner, done checkbox. Exported with the board.
- **Presence.** Who is here, who stepped away, who owns the board.
- **Export.** Markdown download or copy: columns, grouped cards with votes,
  action items. Same output from the UI and the `/export.md` endpoint.
- **Ownership.** The creator can rename, manage columns, lock facilitation to
  themselves, change vote budgets, and delete the board early. Ownership is a
  token in the creating browser; the server stores only its hash.
- **Themes**: System, Light, Dark (side), plus Dagobah, Tatooine and
  Synthwave, and a motion switch in Preferences.
  `prefers-reduced-motion` is a hard override.
- **In-app help** at `/help` covers everything above for participants.

## Data retention

- **All boards are deleted daily at 6:00 AM America/New_York** (the alarm
  follows daylight-saving changes). A board created at 11 PM lives until the
  next morning; one created at 5:50 AM lives ten minutes, and the UI warns on
  create. The board header shows exactly when it goes.
- The wipe is `storage.deleteAll()` on the board's Durable Object: cards,
  votes, names, action items, the owner hash, and the alarm. Nothing is
  archived. There are no backups to restore from, by design.
- While a board is live, its data sits in that one Durable Object and is
  readable by anyone who has the code. **Do not put secrets on a retro board.**
- The server keeps no accounts and no analytics. Request logs follow your
  Cloudflare account's Workers observability settings.
- The browser stores: a random participant id, your display name, owner tokens
  for boards you created, theme and motion preferences, and a list of recent
  boards (pruned as they expire). All under `localStorage` keys prefixed
  `holocron:`. Clearing site data removes them.

Limits: 500 cards per board, 8 columns, 50 participants, 500 characters per
card, 20 ops per second per connection, 10 board creations per minute per IP.

## Run it yourself

See **[docs/self-hosting.md](docs/self-hosting.md)**. Short version: a
Cloudflare account, `bun install`, `npx wrangler login`, `npm run deploy`.
Change the reset time with the `RESET_TZ` and `RESET_HOUR` vars in
`wrangler.jsonc`.

Also: [docs/architecture.md](docs/architecture.md) for how it fits together.

## Stack

React 19 + TypeScript + Vite 7, Tailwind CSS v4, stock shadcn (base-lyra on
Base UI), Oxanium + JetBrains Mono, Phosphor icons, zod, Biome. Cloudflare
Workers + Durable Objects (SQLite storage, WebSocket hibernation) through
`@cloudflare/vite-plugin`. Tests with Vitest inside workerd via
`@cloudflare/vitest-plugin`. No animation libraries: View Transitions, the
Web Animations API, `@starting-style`, and CSS `linear()` springs.

## Commands

```bash
bun install          # npm's resolver currently trips on Vitest 4.1 peers
npm run dev          # http://localhost:5173 with the Worker and DO running locally
npm test             # type-gen + vitest (reducer, reset-time math, DO lifecycle, alarm wipe)
npm run check        # biome
npm run build        # types + tsc + vite build (client + worker)
npm run deploy       # build + wrangler deploy
```

Copy `.dev.vars.example` to `.dev.vars` and set `DEV_BOARD_TTL_SECONDS=60` to
watch a board expire during development.

## Roadmap

- Reactions, card comments.
- Turnstile on board creation if abuse shows up.

## License

MIT.
