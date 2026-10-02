# Architecture

```
Browser ──HTTP──▶ Worker (worker/index.ts) ──RPC──▶ BoardObject (worker/board.ts)
   │                 │  POST /api/boards            create()
   │                 │  GET  /api/boards/:code      meta()
   │                 │  DELETE /api/boards/:code    destroy(token)
   │                 │  GET  …/export.md            exportMarkdown()
   │                 │  GET  /api/config
   └──WebSocket──▶   │  GET  /ws/:code  ──fetch()──▶ acceptWebSocket()
                     └─ everything else: static assets (Vite build, SPA fallback)
```

## One Durable Object per board

The board code is the Durable Object name (`env.BOARD.getByName(code)`), so
the Worker never needs a lookup table. A code that was never created reaches
an object with empty storage, which answers 404.

Inside the object:

- **Storage** is one SQLite row: `board(id=1, json, seq, owner_hash)`. The
  whole board document is small (hundreds of cards at most, gone within a
  day), so it is persisted as a unit after every op. That keeps the server
  and the client running the exact same reducer instead of two
  implementations of each change.
- **Sockets** use the Hibernation API. Each socket's attachment carries the
  participant id, name and `isOwner`. Idle boards cost nothing between
  messages; a keep-alive `ping`/`pong` is answered by the runtime.
- **The alarm** is set to `expiresAt` at creation. `alarm()` broadcasts
  `expired`, closes every socket, and calls `storage.deleteAll()`. Every entry
  point also runs `expireIfDue()` first, so a missed alarm cannot keep a
  board alive.

## The shared reducer

`shared/reducer.ts` exports `reduce(board, op, actor, now)`: a pure function
that returns a new board or throws `OpError`. It is the only way board state
changes, and it contains the permission rules (author-only edits, owner-only
settings, facilitator lock, vote budgets, limits).

- The **server** validates incoming messages with zod (`shared/protocol.ts`),
  runs `reduce`, persists, increments `seq`, and broadcasts
  `{ type: 'op', seq, op, opId, actor, at }`. A refused op goes back to the
  sender as `{ type: 'rejected', opId, reason }`; so does an op over the
  per-socket flood limit, so the sender's optimistic copy rolls back.
- The **client** (`src/hooks/useBoard.ts`) keeps `confirmed` (the server's
  last known state) and `pending` (its own unacknowledged ops). The rendered
  board is `pending.reduce(reduce, confirmed)`, so your own changes show
  instantly and settle when the echo arrives. Before sending, the client runs
  the op locally; an impossible op never leaves the browser and becomes a
  toast instead.
- A `seq` gap (or a reducer disagreement) makes the client ask for a fresh
  snapshot with `{ type: 'sync' }`.

## Identity and ownership

There are no accounts. Each browser generates a random participant id and a
random participant secret, and asks for a display name. All three travel on
the WebSocket URL.

The id is public (it is on every signed card in the snapshot); the secret is
what makes it yours. The first socket a board sees for an id binds that id
to the SHA-256 of the secret it came with; the object keeps the map in its
storage (`participantSecrets`) and never sends it out. A later socket with
the same id and a different secret is closed with code 1008 and reason
`identity`, and the client shows the "does not recognise this browser" page
instead of retrying. This is what makes author-only edits, renames and
`you.anonymousCardIds` trustworthy.

Creating a board returns an **owner token**; the object stores its SHA-256.
The creating browser keeps the token in `localStorage` and sends it on the
socket URL and in the `DELETE` request. `isOwner` is derived only from the
token, never from the participant id.

### Anonymous cards and comments

The document inside the object keeps the real `authorId` on every card and
comment, which is what lets the reducer enforce author-only edits on the
server. That id never leaves the object for anonymous items:

- `redactAnonymous()` blanks `authorId` on anonymous cards and comments in
  every snapshot.
- When an anonymous author acts on their own anonymous item (post, edit,
  delete, move, group, ungroup, comment), the echo to everyone else carries
  an empty actor `{ id: '', name: '' }` plus the item's id in
  `anonymousCardIds` / `anonymousCommentIds`. Only the author's own sockets
  receive the real actor.
- The author learns which anonymous items are theirs from
  `you.anonymousCardIds` / `you.anonymousCommentIds` on the snapshot, and
  from the un-redacted echo of their own ops. `isCardAuthor()` and
  `isCommentAuthor()` check both the id and those lists, so the same reducer
  works on the full document (server) and the redacted one (client).

Votes and reactions are by participant and public, so they are not redacted;
an anonymous author who reacts to their own card does so as themselves.

## Reset time

`shared/reset-time.ts` computes the next `RESET_HOUR` in `RESET_TZ` using
`Intl.DateTimeFormat` parts, so daylight-saving transitions are handled
without a date library. `test/reset-time.test.ts` pins the March and November
transitions.

## Frontend

React 19 with a 100-line `pushState` router (`src/lib/router.ts`). Pages:
home (create / join / recent), board, help, gone. The app's own motion is
platform-only: View Transitions for route and phase changes,
`@starting-style` entrances, FLIP (`useFlip`) for reordering and drops, WAAPI
exits, CSS `linear()` springs baked at startup. The one library in the
stylesheet, `tw-animate-css`, exists for the stock shadcn overlays (dialog,
popover, menus) and is not used elsewhere. Two switches gate everything:
Preferences → Motion (`html[data-motion="off"]`) and `prefers-reduced-motion`.

## Failure modes

| Situation | Behaviour |
|---|---|
| Socket drops | Banner "Reconnecting…", exponential backoff, pending ops replayed, fresh snapshot |
| Board expired while open | `expired` message → Gone page; the code 404s afterwards |
| Owner deletes | `deleted` message to every socket, then `deleteAll()` |
| Two people edit the same card | Last op wins; both see the result |
| Code collision on create | `create()` refuses; the Worker tries another code (up to 5) |
| Alarm missed | Next request to the object sees `expiresAt <= now` and wipes |
