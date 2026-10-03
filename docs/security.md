# Security

How holocron is meant to resist an adversarial client, what was checked
in the review of October 2026 (#65), and what is still open. Every open
item links to its own issue.

## Threat model

There are no accounts. Four secrets carry all of the trust:

| Secret | Who holds it | What it grants | Where it lives |
| --- | --- | --- | --- |
| Board code (6 chars, 32⁶ ≈ 10⁹) | Everyone in the retro | Read the board, join it, export it | Read aloud; in the URL |
| Owner token (256-bit random) | The creator, or whoever redeemed a handoff | Owner ops, delete, handoff | Creator's `localStorage`; only its SHA-256 in the DO |
| Participant secret (random, per browser) | One browser | Act as one participant id | `localStorage`; only its SHA-256 in the DO |
| Handoff code (6 chars, 10 min, single use) | Owner → next owner | One owner token | Shown once; only its SHA-256 in the DO |

The code is **not a secret** in the security sense: anyone who has it is a
participant. The adversary we design against is a participant (or a code
holder) with a scripted client who sends whatever they like over HTTP and the
socket. Out of scope: Cloudflare's platform itself, and anyone who can read
another person's `localStorage`.

Promises we make to participants:

1. Only the owner can do owner things (settings, delete, handoff, and
   facilitation while the lock is on).
2. Nobody can act as another participant.
3. Nobody learns who wrote an anonymous card or comment.
4. Everything is gone after the daily wipe.
5. One client can't take a board down for everyone else.

## What was checked

### Authorization

Every op in `shared/protocol.ts` goes through `reduce()`, which takes the actor
from the socket attachment, never from the op. Rules:

| Op | Who |
| --- | --- |
| `addCard`, `vote`, `unvote`, `setDone`, `setName` | Any participant (votes after Write; `setDone` only in Write, only for yourself) |
| `editCard`, `editComment` | Author only, never the owner |
| `deleteCard`, `deleteComment` | Author or owner |
| `moveCard`, `groupCards`, `ungroupCard` | Author or owner of every card the op changes (`arrangedCards`): a moved card's whole group, a grouped card's whole group and the target, and on `ungroupCard` the last member of a group it dissolves ([#87](https://github.com/jbouder/holocron/issues/87)); anyone when the facilitation lock is off. A new group id can't name an existing group |
| `toggleReaction`, `addComment` | Any participant, except on a card still blurred for them, or an anonymous card still blurred for everyone else |
| `setPhase`, `setTimer`, `clearTimer`, `addColumn`, `renameColumn`, `setColumnPrompt`, `deleteColumn`, `renameBoard` | Owner while the lock is on (the default), else anyone |
| `updateSettings` | Owner only, always |
| `removeParticipant` | Owner only, never on the owner ([#80](https://github.com/jbouder/holocron/issues/80)) |
| `setOwner` | Server only: not in `ClientMessageSchema`; emitted after a handoff redeem |
| `addActionItem` | Any participant |
| `editActionItem`, `toggleActionItem`, `deleteActionItem` | Owner while the lock is on, else anyone ([#72](https://github.com/jbouder/holocron/issues/72)) |

`test/reducer.test.ts` → "permission rules" has a negative case for each rule.
`setTimer`'s `endsAt` is overwritten with the server clock.

### Owner token

- Issued only by `create()` and `redeemHandoff()`; 32 random bytes; only its
  SHA-256 is stored.
- Accepted in the socket's `hello` and as `Authorization: Bearer` on
  `DELETE /api/boards/:code` and `POST …/handoff`. Nowhere else, and never
  on a URL ([#84](https://github.com/jbouder/holocron/issues/84)).
- Never sent to a client after issue: snapshots carry `you.isOwner`, not the
  token or hash.
- Rotated by a handoff; live sockets of the old owner lose ownership at once.
- Compared as SHA-256 hex with `crypto.subtle.timingSafeEqual` (`sameHash`
  in `worker/board.ts`), like the participant secret and the handoff code
  ([#74](https://github.com/jbouder/holocron/issues/74)).

### Identity binding

- A socket's URL carries only `pid` and `name`, both public. The object
  accepts it as *pending*: not seated, not online, sent nothing. Its first
  message must be `{ type: 'hello', secret, token? }`; anything else closes
  it with `1008 hello`, and so does a hello that hasn't come within 10 s
  (checked on the board's next event, since hibernation rules out timers).
  At most 20 sockets wait at once; past that the oldest goes. Credentials
  in a first message never reach request logs
  ([#84](https://github.com/jbouder/holocron/issues/84)).
  `Sec-WebSocket-Protocol` was rejected for this: whether headers reach
  Workers Logs isn't clearly documented.
- The first socket that gets a seat for a participant id stores the
  SHA-256 of its `secret`.
  A later socket with that id and a different secret is closed with
  `1008 identity` (test: "binds an id to the first secret…").
- The only other path that takes a participant id is the handoff redeem, and
  it checks the same binding (`reason: 'stranger'`).
- `POST /api/boards` takes the creator's secret with their id and binds it
  in `create()`, so the owner's id is never up for grabs before their first
  socket ([#74](https://github.com/jbouder/holocron/issues/74)).
- Display names aren't unique or verified. Anyone can call themselves "Leia".

### Anonymity

- Snapshots: `redactAnonymous()` blanks `authorId` on anonymous cards and
  comments. Each snapshot's `you` lists the recipient's own.
- Echoes: `anonymousTarget()` covers `addCard`, `editCard`, `deleteCard`,
  `moveCard`, `groupCards`, `ungroupCard`, `addComment`, `editComment` and
  `deleteComment`. Other sockets get `actor: { id: '', name: '' }`. For the
  three arrangement ops it checks every card the op changes, not just the
  one named: under the lock an accepted op says the actor may arrange them
  all, so naming them would unmask an anonymous group member.
- `presence`, `rejected`, `deleted`, `expired` carry no author ids. `rejected`
  goes to the sender only.
- Exports print no author for anonymous items.
- Test: "anonymity across every message" runs every anonymous-capable op and
  checks that no message reaching another participant or the owner (and no
  export) has the author's id or name.

An anonymous card still blurred for everyone else in Write is *sealed*
(`isCardSealed`): only its author can read it, so a reaction, comment or
action-item link on it could only come from them and would name them.
The reducer refuses all three on a sealed card for everyone, the author
included, until Write ends or blurring is turned off. The UI hides them
(fixed in [#67](https://github.com/jbouder/holocron/issues/67); test:
"sealed anonymous cards").

### Blur during Write

While cards are blurred (`blursCards`), the text of a card, and of the
comments on it, only goes to its author. `redactHidden()` blanks it in each
recipient's snapshot and `redactHiddenOp()` in each echo. When a phase or
settings change lifts or brings back the blur, every socket gets a fresh
snapshot. Exports, which need no identity, leave cards out until Write ends
(fixed in [#68](https://github.com/jbouder/holocron/issues/68); tests:
"blurred cards stay on the server", "blurred cards on the wire").

### The wipe

The DO writes four things: the `board` SQL table, the `participantSecrets`
and `handoff` KV keys, and the alarm. `wipe()` calls `deleteAlarm()` then
`deleteAll()`, which removes all of them, and resets every in-memory field.
`expireIfDue()` runs first in every entry point: `create`, `meta`,
`destroy`, `startHandoff`, `redeemHandoff`, `export`, `fetch`,
`webSocketMessage`, `webSocketClose` and `webSocketError` (the last two
since [#74](https://github.com/jbouder/holocron/issues/74)). A probe of an
unknown code leaves no storage behind (test: "storage hygiene").

### Input validation

Every socket message is parsed with zod (`ClientMessageSchema`) before it
reaches the reducer. Invalid JSON or schema mismatches are dropped silently.
HTTP bodies use `CreateSchema` and `RedeemSchema`. Codes are normalized and
checked against `^[A-HJ-NP-Z2-9]{6}$` before a DO is touched. Server-side
bounds:

| Thing | Bound | Where |
| --- | --- | --- |
| Title / name / column title / prompt | 80 / 40 / 40 / 120 chars | zod |
| Card / comment / action item text | 500 / 300 / 300 chars | zod |
| Ids (card, column, op, participant) | 64 chars | zod; `pid` sliced in `fetch` |
| Participant secret, owner token | 128 chars | zod (`hello`), `RedeemSchema` |
| Cards / columns / action items | 500 / 8 / 100 | reducer |
| Comments | 20 per card, 500 per board | reducer |
| Reactions | 3000 per board, fixed emoji set | reducer, zod enum |
| Participants | 50 per board | reducer (`withParticipant`) |
| Votes per person | 1–20 setting, enforced on every vote | zod, reducer |
| Timer | 1–15 min | zod |

Binary socket frames are ignored. Raw frame size is bounded only by the
platform's WebSocket message limit before `JSON.parse`.

### Abuse and DoS

| Limit | Value | When exceeded |
| --- | --- | --- |
| Board creation | 10/min per IP (`CREATE_LIMITER`), optional Turnstile | 429 |
| Requests by code (meta, export, delete, handoff, socket) | 300/min per IP per Cloudflare location (`PROBE_LIMITER`) | 429; socket closed `1013 limited`, client retries |
| Ops per socket | 20/s sliding window | `rejected` "Too many changes at once"; sender rolls back |
| Wrong handoff codes | 5/min per board, 10-minute code | 429; at most ~50 guesses per code against 10⁹ |
| Seats | 50 per board; a full board gives a newcomer the first idle seat | close `1008 full` |
| Sockets | 5 per participant, 120 per board (the owner is exempt from the board cap) | past 5, the participant's oldest socket closes `1008 replaced`; past 120, close `1008 full` |
| Sockets waiting for `hello` | 20 per board, 10 s each | the oldest closes `1008 hello`; the client retries |
| Document size | bounded by the limits above | each op re-persists the whole document |

Seats and sockets (fixed in [#71](https://github.com/jbouder/holocron/issues/71)):

- A participant may hold 5 sockets and a board 120, counted before a new
  socket joins them (sockets the object already closed don't count). Past
  the participant cap the newest tab wins: once the new socket is seated,
  the participant's oldest sockets close with `1008 replaced`. The server
  can't tell a live tab from one left half-open by a network cut or a
  sleeping laptop, so refusing the newcomer would shut out someone with
  fewer live tabs than the cap
  ([#88](https://github.com/jbouder/holocron/issues/88)). Only a socket that
  passed the secret check replaces anything, so nobody else can close a
  participant's tabs.
- Past the board cap the new socket closes with `1008 full`; sockets it
  would replace don't count against it. The client shows a page instead of
  retrying on `full` and on `replaced` (a replaced tab that retried would
  evict its replacement in turn). The board cap does not apply to a socket
  that carries the owner token, so a crowd of tabs cannot keep the owner
  from running or ending the retro.
- A full board gives a newcomer the first seat (in joining order) whose
  holder is offline and left nothing public: no signed card or comment,
  vote, reaction or "done" (`canReleaseSeat`). The release is a server-only
  `releaseSeat` op with an actor that names no one. Anonymous items are
  ignored on purpose: if they kept a seat, which seats stay would reveal
  who wrote them. They stay the author's, because authorship is by id.
- A participant's secret is bound only once they're seated, so refused
  joins leave nothing in storage. A released seat's binding goes too,
  unless it protects anonymous items. The bindings stay one small value
  instead of growing with every scripted join.
- A client that keeps 49 sockets open holds every seat while it stays
  online. The owner removes it from the People list
  ([#80](https://github.com/jbouder/holocron/issues/80)): a
  `removeParticipant` op takes the seat, their votes, reactions and
  "done", and adds the id to `board.removed`. The object closes all of
  that id's sockets with `1008 removed` and refuses its later hellos the
  same way until the wipe clears the list. Cards and comments stay, signed
  or anonymous, so the op changes nothing that would say who wrote an
  anonymous one; the echo names only the owner. The binding goes unless it
  protects anonymous items, as for a released seat. A client that comes
  back under a fresh id needs removing again, so this answers a person, not
  a script that mints ids; the per-IP request limit is what slows that.

### Code enumeration

32⁶ ≈ 1.07 × 10⁹ codes. Every request that names a code (`meta`, `export`,
`DELETE`, the handoff routes and the socket upgrade) draws on one per-IP
budget of 300 a minute (`PROBE_LIMITER`), whatever the code and whether a
board exists; `DELETE` and handoff count because they answer 403 for a live
board and 404 for an unknown one before any token is checked. Past it, HTTP
answers 429 and a socket is accepted and closed with `1013 limited`. The
client waits and retries instead of calling the board missing. At that rate
one address makes ~430,000 guesses a day; with 1,000 live boards that's
about one find every two days per address. The binding counts per
Cloudflare location and is best-effort, so an attacker who reaches several
locations gets a budget at each, and a botnet gets further still; the daily
wipe caps how long any find is useful
([#70](https://github.com/jbouder/holocron/issues/70)). Malformed codes are
refused before the limiter and before any Durable Object is touched.

### Client rendering and exports

- No `dangerouslySetInnerHTML`, `innerHTML`, `eval` or user-controlled `href`
  in `src/` (outside the CLI-managed `src/components/ui`). All user text
  renders as React text nodes. The one `href` built from data is the export
  URL, from a validated code and a fixed format.
- The analysis prompt is built from card text only (no names or ids) and
  runs in a Web Worker. Model output is rendered as text.
- CSV export: RFC 4180 quoting; cells starting with `= + - @ \t \r` are
  prefixed with `'`.
- Markdown export: every user string (title, column titles and prompts,
  card and comment text, author names, action items and their owners) is
  put on one line and escaped. That covers ``\ ` * _ [ ] < > # | ~`` and a
  leading `-`, `+`, `=` or `1.`, so pasted exports can't carry links,
  images, inline HTML or fake task boxes. Checked against markdown-it with
  raw HTML enabled (fixed in
  [#73](https://github.com/jbouder/holocron/issues/73)). The plain-text
  summary stays raw for chat.

### Transport and headers

- Static assets (`public/_headers`): a CSP with no inline script except the
  theme script by hash (pinned by `test/headers.test.ts`), `'wasm-unsafe-eval'`
  for WebLLM, Turnstile for script and frame, `connect-src` limited to this
  origin, Hugging Face and `raw.githubusercontent.com`, and
  `frame-ancestors 'none'`. Also `nosniff`, `X-Frame-Options: DENY`,
  `Permissions-Policy` and `Referrer-Policy: same-origin`. Worker responses:
  `nosniff`, `default-src 'none'; frame-ancestors 'none'`,
  `Referrer-Policy: no-referrer`
  (fixed in [#69](https://github.com/jbouder/holocron/issues/69)).
  `style-src` allows `'unsafe-inline'` for style attributes set by Turnstile
  and the UI library.
- WebSocket `Origin` isn't checked. That's acceptable: the socket carries no
  ambient credentials (no cookies). Every credential is in the `hello`,
  which a cross-site page can only send if it already has the secrets.
- The socket URL, which Workers Logs record when enabled, carries only the
  participant id and name (also documented in `docs/data-retention.md`;
  fixed in [#84](https://github.com/jbouder/holocron/issues/84)).

### Dependencies

`bun audit` (October 2026): one high, `braces` ≤ 3.0.3 (GHSA-vfj7-8cjw-p6xm,
ReDoS via nested patterns). It's only reachable through
`shadcn › @shadcn/registry › fast-glob › micromatch`, the dev-time component
CLI. Not shipped to the Worker or the browser, and it never sees user input.
No action beyond `bun update` when shadcn bumps it.

### Workflows

Every `uses:` in `.github/workflows/*.yml` is pinned to a full commit SHA,
with the release it points to in a trailing `# vX.Y.Z` comment (fixed in
[#93](https://github.com/jbouder/holocron/issues/93)). A tag can be
repointed by whoever controls the action's repository; a SHA can't. This
matters most in the deploy and preview jobs, where `wrangler-action` gets
`CLOUDFLARE_API_TOKEN`: any earlier action in the same job (`checkout`,
`setup-bun`, `cache`) runs on the same runner and could tamper with that
step, so all of them are pinned. Dependabot's monthly `github-actions`
updates move the SHA and the comment together.

The Cloudflare token reaches only the `gate` jobs, which test that it is set
in a shell step with no third-party code, and the jobs that deploy or delete
a Worker. CI (`check`) never sees it, and fork and Dependabot PRs get no
repository secrets.

## Findings

None open. Every finding from the review is fixed, and the sections above
link the issue that fixed it. Record new ones here as a table
(`| # | Severity | Finding |`), and drop each row once it's fixed.
