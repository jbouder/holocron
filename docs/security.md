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
| `moveCard`, `groupCards`, `ungroupCard` | Author or owner; anyone when the facilitation lock is off |
| `toggleReaction`, `addComment` | Any participant, except on a card still blurred for them, or an anonymous card still blurred for everyone else |
| `setPhase`, `setTimer`, `clearTimer`, `addColumn`, `renameColumn`, `setColumnPrompt`, `deleteColumn`, `renameBoard` | Owner while the lock is on (the default), else anyone |
| `updateSettings` | Owner only, always |
| `setOwner` | Server only: not in `ClientMessageSchema`; emitted after a handoff redeem |
| `addActionItem`, `editActionItem`, `toggleActionItem`, `deleteActionItem` | Anyone, regardless of the lock ([#72](https://github.com/jbouder/holocron/issues/72)) |

`test/reducer.test.ts` → "permission rules" has a negative case for each rule.
`setTimer`'s `endsAt` is overwritten with the server clock.

**Open:** action items ignore the facilitation lock, and `groupCards` doesn't
check the *target* card ([#72](https://github.com/jbouder/holocron/issues/72)).

### Owner token

- Issued only by `create()` and `redeemHandoff()`; 32 random bytes; only its
  SHA-256 is stored.
- Accepted on the socket URL (`token`) and as `Authorization: Bearer` on
  `DELETE /api/boards/:code` and `POST …/handoff`. Nowhere else.
- Never sent to a client after issue: snapshots carry `you.isOwner`, not the
  token or hash.
- Rotated by a handoff; live sockets of the old owner lose ownership at once.
- Compared as SHA-256 hex with `!==`. Timing can only leak the prefix of the
  *hash*, which doesn't help anyone find the token. A constant-time compare is
  still worth having ([#74](https://github.com/jbouder/holocron/issues/74)).

### Identity binding

- The first socket for a participant id stores the SHA-256 of its `secret`.
  A later socket with that id and a different secret is closed with
  `1008 identity` (test: "binds an id to the first secret…").
- The only other path that takes a participant id is the handoff redeem, and
  it checks the same binding (`reason: 'stranger'`).
- `POST /api/boards` takes the creator's id **without** a secret, so the
  owner's id is unbound until their first socket. Someone who reads `ownerId`
  from a snapshot first could claim it. The window is short, but it
  shouldn't exist ([#74](https://github.com/jbouder/holocron/issues/74)).
- Display names aren't unique or verified. Anyone can call themselves "Leia".

### Anonymity

- Snapshots: `redactAnonymous()` blanks `authorId` on anonymous cards and
  comments. Each snapshot's `you` lists the recipient's own.
- Echoes: `anonymousTarget()` covers `addCard`, `editCard`, `deleteCard`,
  `moveCard`, `groupCards`, `ungroupCard`, `addComment`, `editComment` and
  `deleteComment`. Other sockets get `actor: { id: '', name: '' }`.
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
`expireIfDue()` runs first in `create`, `meta`, `destroy`, `startHandoff`,
`redeemHandoff`, `export`, `fetch` and `webSocketMessage`. `webSocketClose`
and `webSocketError` skip it. They only broadcast presence, but should follow
the rule ([#74](https://github.com/jbouder/holocron/issues/74)). A probe of an
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
| Participant secret | 128 chars | `fetch`, `RedeemSchema` |
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
| Ops per socket | 20/s sliding window | `rejected` "Too many changes at once"; sender rolls back |
| Wrong handoff codes | 5/min per board, 10-minute code | 429; at most ~50 guesses per code against 10⁹ |
| Seats | 50 per board | close `1008 "This board is full"` |
| Document size | bounded by the limits above | each op re-persists the whole document |

**Open:** no cap on sockets per participant or per board, so the per-socket op
limit multiplies. Seats are never released, so 49 scripted joins lock a board
for the day ([#71](https://github.com/jbouder/holocron/issues/71)).

### Code enumeration

32⁶ ≈ 1.07 × 10⁹ codes. With 1,000 live boards, a probe hits once per ~10⁶
requests. `meta`, `export` and the socket upgrade have no rate limit, so a
determined prober finds boards within a day, and `export.md` hands over the
whole board ([#70](https://github.com/jbouder/holocron/issues/70)). The
daily wipe caps how long any find is useful.

### Client rendering and exports

- No `dangerouslySetInnerHTML`, `innerHTML`, `eval` or user-controlled `href`
  in `src/` (outside the CLI-managed `src/components/ui`). All user text
  renders as React text nodes. The one `href` built from data is the export
  URL, from a validated code and a fixed format.
- The analysis prompt is built from card text only (no names or ids) and
  runs in a Web Worker. Model output is rendered as text.
- CSV export: RFC 4180 quoting; cells starting with `= + - @ \t \r` are
  prefixed with `'`.
- Markdown export: user text is **not** escaped
  ([#73](https://github.com/jbouder/holocron/issues/73)).

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
  ambient credentials (no cookies). Every credential is in the URL, which a
  cross-site page can only build if it already has the secrets.
- Credentials on the socket URL end up in Workers Logs when they're enabled
  (also documented in `docs/data-retention.md`;
  [#74](https://github.com/jbouder/holocron/issues/74)).

### Dependencies

`bun audit` (October 2026): one high, `braces` ≤ 3.0.3 (GHSA-vfj7-8cjw-p6xm,
ReDoS via nested patterns). It's only reachable through
`shadcn › @shadcn/registry › fast-glob › micromatch`, the dev-time component
CLI. Not shipped to the Worker or the browser, and it never sees user input.
No action beyond `bun update` when shadcn bumps it.

## Findings

| # | Severity | Finding |
| --- | --- | --- |
| [#70](https://github.com/jbouder/holocron/issues/70) | Medium | Board-code probing isn't rate-limited |
| [#71](https://github.com/jbouder/holocron/issues/71) | Medium | Unbounded sockets; seats never released |
| [#72](https://github.com/jbouder/holocron/issues/72) | Low | Action items and the `groupCards` target ignore the facilitation lock |
| [#73](https://github.com/jbouder/holocron/issues/73) | Low | Markdown export doesn't escape user text |
| [#74](https://github.com/jbouder/holocron/issues/74) | Low | Owner id unbound at create; non-constant-time compares; tokens in socket URL; two handlers skip `expireIfDue()` |

When one of these is fixed, update the section above and drop it from the
table.
