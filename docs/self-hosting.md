# Running Holocron on your own Cloudflare account

Holocron is a single Cloudflare Worker with one Durable Object class. There is
no database to provision, no queue, no KV namespace. Deploying creates:

| Resource | What it is |
|---|---|
| Worker `holocron` | Serves the built app (static assets) and routes `/api/*` and `/ws/*` |
| Durable Object `BoardObject` | One instance per board, SQLite-backed, created on demand |
| Rate limit binding | Caps board creation at 10 per minute per IP |

Boards live only inside their Durable Object. When a board expires its object
deletes all of its storage, so an idle deployment holds nothing.

## Prerequisites

- A Cloudflare account. The free Workers plan is enough for a few teams;
  Durable Objects with SQLite storage are included on the free plan with
  limits, see [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).
- Node 22+ and [bun](https://bun.sh) (used for installs; npm's resolver
  currently fails on Vitest 4.1's peer dependencies).

## Deploy from your machine

```bash
git clone https://github.com/jbouder/holocron
cd holocron
bun install
npx wrangler login        # opens the browser once
npm run deploy            # builds, then `wrangler deploy`
```

The first deploy prints a `*.workers.dev` URL. Open it; you have a Holocron.

`wrangler deploy` reads `wrangler.jsonc` at the repository root. The Vite
plugin writes the final config and bundle under `dist/` and points wrangler at
it, so no `--config` flag is needed.

## Change when boards are wiped

The reset time is two variables in `wrangler.jsonc`:

```jsonc
"vars": {
  "RESET_TZ": "America/New_York",   // any IANA time zone
  "RESET_HOUR": "6"                  // 0–23 in that zone
}
```

Edit and redeploy. New boards pick up the new schedule; boards created before
the change keep the expiry they were created with. The home page and Help page
read the live value from `/api/config`, so the copy stays correct.

## Custom domain

In the Cloudflare dashboard: Workers & Pages → holocron → Settings → Domains &
Routes → Add → Custom domain. Or add to `wrangler.jsonc`:

```jsonc
"routes": [{ "pattern": "retro.example.com", "custom_domain": true }]
```

WebSockets work on custom domains without extra configuration.

## Deploy from GitHub Actions

Three workflows:

- `.github/workflows/ci.yml` runs the `check` job (Biome, `tsc -b`,
  `vite build`, Vitest) on every pull request and every push to `main`. It
  never deploys and never touches a secret.
- `.github/workflows/deploy.yml` runs when CI succeeds on a commit pushed to
  `main`, and deploys exactly that commit. Run it by hand (Actions → Deploy →
  Run workflow on `main`) to re-deploy the current `main` without re-running
  CI, for example after rotating the Cloudflare token or changing a var in
  `wrangler.jsonc`.
- `.github/workflows/preview.yml` deploys each pull request from a branch in
  this repository as its own Worker (see [Pull request previews](#pull-request-previews)).

Deploy and Preview need two repository secrets:

| Secret | Where to get it |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Dashboard → My Profile → API Tokens → Create → "Edit Cloudflare Workers" template |
| `CLOUDFLARE_ACCOUNT_ID` | Dashboard → Workers & Pages → Overview (right-hand column) |

Add them under Settings → Secrets and variables → Actions as repository
secrets (the workflows check for the token before it enters the
environment, so environment-scoped secrets are not seen). Without
`CLOUDFLARE_API_TOKEN` the deploy and preview jobs are skipped and the runs
stay green, so a fork gets the checks only. The deploy job uses a `production` environment;
create it (Settings → Environments) if you want required reviewers before a
deploy. Deploys queue rather than cancel one another.

Pull requests never deploy to production. PRs from forks never see the
Cloudflare secrets and get no preview. To block merging until checks pass, add
a branch protection rule (or ruleset) on `main` under Settings → Branches with
"Require status checks to pass" and select `check` (from CI). Do not add the
Deploy or Preview jobs: Deploy runs only after merge, and Preview skips for
forks and when the secrets are missing, so a PR could wait on them forever.
GitHub only offers `check` once the job has run at least once.

### Pull request previews

Cloudflare's version preview URLs are not generated for Workers that
implement a Durable Object, so each pull request gets a whole Worker instead,
named `holocron-pr-<number>` on your `workers.dev` subdomain:

- Opening, pushing to or reopening the PR builds it and deploys that Worker,
  then posts the URL as one PR comment that later pushes update.
- Closing or merging the PR deletes the Worker (`wrangler delete --force`) and
  says so in the comment.
- A preview has its own Durable Object namespace, so its boards are separate
  from production's and are wiped on the same schedule. Board creation uses
  rate-limit namespace `1002` instead of production's `1001` (namespaces are
  account-wide), and Turnstile is always off.

Previews run only for PRs from branches in this repository, using the same
`CLOUDFLARE_API_TOKEN`; the "Edit Cloudflare Workers" template already allows
creating and deleting Workers. Anyone who can push a branch can therefore run
code with that token, so keep push access to people you would trust with a
deploy. To turn previews off, disable the workflow (Actions → Preview → ⋯ →
Disable workflow) or delete `.github/workflows/preview.yml`. If a preview
Worker is ever left behind, delete it with
`npx wrangler delete holocron-pr-<number>`.

### Dependency updates

`.github/dependabot.yml` asks Dependabot for monthly pull requests: npm
packages (through `package.json` and `bun.lock`) and the GitHub Actions the
workflows use. Minor and patch bumps are grouped into one PR per ecosystem;
each major version gets its own. They are ordinary PRs, so they run `check`
and never deploy (Dependabot runs don't see repository secrets, so they get
no preview either). Nothing merges automatically.

On a fork, Dependabot version updates follow this file once you enable them
under Settings → Code security. Turn on Dependabot alerts and security
updates there too if you want patches for known vulnerabilities between the
monthly runs. Leave `src/components/ui/*` to the shadcn CLI; Dependabot only
touches dependency manifests.

## Local development

```bash
cp .dev.vars.example .dev.vars   # optional
npm run dev
```

`npm run dev` runs Vite with the Cloudflare plugin: the Worker and the Durable
Object run locally in Miniflare with hot reload, state persisted under
`.wrangler/`. Open two browser tabs on the same board to see live sync.

Set `DEV_BOARD_TTL_SECONDS=60` in `.dev.vars` to make new boards expire a
minute after creation so you can watch the wipe.

## Observability

- `npm run tail` streams live logs (`wrangler tail`).
- `observability.enabled` is on in `wrangler.jsonc`, so Workers Logs in the
  dashboard keeps recent invocations.
- The Worker logs one JSON line per failed request. Normal traffic is not
  logged by the app.

## Wiping everything now

Every board wipes itself at the reset. To remove everything immediately,
delete the Worker (Dashboard → Workers & Pages → holocron → Settings →
Delete), which also deletes the Durable Object namespace and all its storage.
Redeploying starts clean.

## Turnstile on board creation (optional)

Creating a board needs no account, so the only guard by default is the
per-IP rate limit (10 boards a minute, `CREATE_LIMITER` in `wrangler.jsonc`).
If you see abuse from many addresses, require a
[Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/) check
on the home page's Create button. Joining a board is never affected.

1. Dashboard → Turnstile → Add widget. Add your hostname (and `localhost` if
   you want it in development), mode **Managed**. Copy the site key and the
   secret key.
2. Put the site key in `wrangler.jsonc`:

   ```jsonc
   "vars": {
     // ...
     "TURNSTILE_SITE_KEY": "0x4AAAAAAA..."
   }
   ```

3. Store the secret as a Worker secret (it is never committed):

   ```bash
   npx wrangler secret put TURNSTILE_SECRET_KEY
   ```

4. `npm run deploy`.

Turnstile is on only when **both** are set; with either one missing, board
creation works exactly as without it. When on, the Worker redeems the token
with Siteverify before creating the board and checks the action
(`create-board`) and that the hostname is the one the request came to. A
missing token is a 400, a failed check a 403, and Siteverify being
unreachable a 503; all three stop the board from being created. The IP rate
limit still runs first.

To try it locally, use Cloudflare's always-pass
[test keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)
in `.dev.vars` (see `.dev.vars.example`). To turn it off again, set
`TURNSTILE_SITE_KEY` back to `""` and redeploy, or delete the secret.

Turnstile is a Cloudflare service: when it is on, the home page loads its
script from `challenges.cloudflare.com` and visitors who create a board are
checked by it. See [data-retention.md](data-retention.md).

## Limits you may want to change

All in `shared/limits.ts`: cards per board, columns, participants, card
length, votes range, timer range, ops per second. The create rate limit is in
`wrangler.jsonc` under `ratelimits`.

## Updating

```bash
git pull
bun install
npm run deploy
```

Durable Object migrations are declared in `wrangler.jsonc`. The current
version has one (`v1`, `new_sqlite_classes`). If a future version adds a
migration tag, deploying applies it.

## Link previews

`index.html` carries Open Graph tags so a pasted link unfurls in Slack,
Teams and the like. Preview images have to be absolute URLs, so `og:image`
points at the public instance. On your own deployment, change it to your
origin:

```html
<meta property="og:image" content="https://retro.example.com/og.png" />
```

The image itself (`public/og.png`), the favicons and the manifest icons are
rendered from `docs/brand/mark.svg`; nothing else needs to change.

## Response headers

`public/_headers` sets `Referrer-Policy: same-origin` on everything the
Worker serves (Cloudflare's static assets read that file). Keep it if you
serve the built files some other way: a board URL carries its code, and the
Analysis panel's model download fails without it, because Hugging Face
rejects requests whose `Referer` is a `*.workers.dev` page. The worker
script's own response header is what governs those requests.
