# Data retention and privacy

## What is stored, and where

**On the server (one Durable Object per board), while the board is live:**

- board title, template, phase, settings, timer
- columns
- cards: text, author's participant id and display name (empty if anonymous),
  group membership, position, timestamp
- votes: card id, participant id, count
- reactions: card id, participant id, emoji (from a fixed set)
- comments: text, card id, author's participant id and display name (empty if
  anonymous), timestamps

The author's participant id on an **anonymous** card or comment stays inside
the Durable Object. Other participants, the owner included, receive it blank,
and the live updates about that card do not name the author either. Only the
browser that posted it is told it is theirs. Votes and reactions are not
anonymous: everyone can see who voted or reacted.
- action items: text, owner name, done flag
- participants: id and display name
- a SHA-256 hash of each participant's browser secret (never the secret), so
  nobody else can connect under their id
- a SHA-256 hash of the owner token (never the token)
- the sequence number and the expiry time

**In the participant's browser (`localStorage`, keys prefixed `holocron:`):**

- a random participant id, a random participant secret, and the display name
- owner tokens for boards created in that browser
- theme, motion and timer-sound preferences
- recent boards (code, title, expiry), pruned as they expire

**In the owner's browser, only if they enable Analysis:**

- the language model's weights and runtime (about 1 GB for the default
  Qwen3 1.7B, up to about 4.6 GB for Qwen3 8B, in Cache Storage under
  `webllm/*`), downloaded from Hugging Face and the mlc-ai GitHub releases
  the first time the owner agrees to it, and kept so the next retro does not
  download them again. Clearing site data removes them.
- which model the owner picked (`localStorage` key `holocron:analysis-model`).

Nothing else. No cookies, no accounts, no analytics, and no third-party
scripts unless the deployment turned on Turnstile (below).

**Analysis.** The owner-only Analysis panel runs a small language model
inside the owner's browser, on their GPU, over the cards and comments that
browser already holds. The prompt contains card text, column titles, vote
counts and comment text, and no names or participant ids. Nothing is sent to
a server or an AI service; the model download above is the only network
request it makes, and the download host sees the request, not the board.
The suggestions live in the owner's tab until it is closed. They are not
stored, exported or sent to anyone; a suggestion the owner accepts becomes an
ordinary card group or action item, wiped with everything else.

**Turnstile, if enabled.** A deployment can require a
[Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) check
before a board is created (off by default; see
[self-hosting.md](self-hosting.md)). When it is on, the home page loads
Turnstile's script from `challenges.cloudflare.com`, which collects signals
from the browser to tell people from bots, and the Worker sends the resulting
token and the client IP to Cloudflare's Siteverify API. Holocron stores
nothing from it. Cloudflare's handling is described in its
[Turnstile privacy addendum](https://www.cloudflare.com/turnstile-privacy-policy/).
Joining a board never involves Turnstile.

## How long

**Every board is wiped daily at the configured reset time**, 6:00 AM
America/New_York by default. The board's Durable Object fires an alarm at its
expiry and runs `storage.deleteAll()`: the document, the owner hash and the
alarm itself are deleted. Any request to the object afterwards finds empty
storage and answers 404. An owner can delete a board earlier; the same wipe
runs.

Boards do not reset to empty; they cease to exist. There is no archive,
export history, or backup. What a team wants to keep, it exports (Markdown,
CSV of action items, or a plain-text summary) before the reset.

Request logs (status, URL, timing) are kept according to your Cloudflare
account's Workers Logs retention. The participant id and secret, the display
name and, for the owner, the owner token are sent as query parameters on the
WebSocket URL, so a deployment with Workers Logs enabled has them in its
request logs for as long as that retention lasts. The application itself logs one line
per unexpected server error and nothing per successful request.

## Who can see a board

Anyone with the six-character code or the link. Codes are random from a space
of about one billion, so guessing is impractical, but they are not secrets:
they are read out loud in meetings. Treat a board like a whiteboard in a
shared room and do not put credentials or personal data on it.

## Deleting your own data

- Your cards: delete them from the card menu.
- Your name: it is only in your browser and on your cards; change it from
  Preferences, or clear the site's storage.
- A board you own: Board actions → Delete board.
- Everything: wait for the reset.
