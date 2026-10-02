# Data retention and privacy

## What is stored, and where

**On the server (one Durable Object per board), while the board is live:**

- board title, template, phase, settings, timer
- columns
- cards: text, author's participant id and display name (empty if anonymous),
  group membership, position, timestamp
- votes: card id, participant id, count
- action items: text, owner name, done flag
- participants: id and display name
- a SHA-256 hash of the owner token (never the token)
- the sequence number and the expiry time

**In the participant's browser (`localStorage`, keys prefixed `holocron:`):**

- a random participant id and the display name
- owner tokens for boards created in that browser
- theme and motion preferences
- recent boards (code, title, expiry), pruned as they expire

Nothing else. No cookies, no accounts, no analytics, and no third-party
scripts unless the deployment turned on Turnstile (below).

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
export history, or backup. What a team wants to keep, it exports as Markdown
before the reset.

Request logs (status, path, timing) are kept according to your Cloudflare
account's Workers Logs retention. The application logs one line per failed
request and nothing per successful one.

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
