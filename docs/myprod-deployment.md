# Myprod Deployment

## Automatic Deployment

Every push to `main` runs backend tests, publishes a multi-platform image, and
deploys its exact immutable digest to Myprod. The workflow then verifies the
public `/health` response. Production runs are serialized without cancelling
an active deployment. A failed test or build prevents deployment.

One-time setup: in Myprod, open Moodish's **CI tokens**, generate an app-scoped
token, and save it in this GitHub repository's Actions secrets as
`MYPROD_DEPLOY_TOKEN`. Never use the dashboard-wide operator token. Run
**Build and deploy Moodish** from GitHub Actions to verify setup; later pushes
deploy automatically. A missing token fails the deploy job explicitly.

Runtime secrets remain in Myprod's **Secrets & registry**. Save and apply them
there; CI uses the last applied version and does not activate pending drafts.
Managed secrets are injected directly into the environment and do not require
the legacy runtime-file mount described below.

Moodish runs on Myprod as a public container image managed by Nomad and Traefik.

## Image Contract

- App name: `moodish`
- Image: `ghcr.io/blackdragoon26/moodish:<commit-sha>`
- Architecture: `linux/arm64` for current Myprod nodes, plus `linux/amd64` for local verification
- Container port: `8787`
- Health path: `/health` (liveness). `/health/ready` also checks PostgreSQL and
  returns 503 when storage is configured but unreachable.
- Process: `npm start`
- Listener: `0.0.0.0:8787`
- Recommended CPU: `500` MHz
- Recommended memory: `768` MB
- Ephemeral data: local memory and process state are disposable; durable group/profile data belongs in `DATABASE_URL`

## Non-Secret App Config

These values can be entered in the Myprod application form:

```env
NODE_ENV=production
HOST=0.0.0.0
PORT=8787
MOODISH_WEB_PORT=8787
SWIGGY_MODE=fixture
SWIGGY_OAUTH_ENABLED=false
AI_PROVIDER=openrouter
OPENROUTER_MODEL=openai/gpt-4o-mini
AI_PROVIDER_TIMEOUT_MS=4500
MOODISH_PUBLIC_URL=https://moodish.sankalpjha.dev
TEAMS_TENANT_ID=common
```

Set `SWIGGY_OAUTH_ENABLED=true` to allow connection setup. Keep `SWIGGY_MODE=fixture`
until the canonical production callback has passed phone/OTP consent and authenticated
read checks. Then set `SWIGGY_MODE=live`. Localhost authentication success alone does
not prove that the production callback is approved.

Canonical Swiggy callback: `https://moodish.sankalpjha.dev/api/auth/swiggy/callback`.
Live production requires durable PostgreSQL, a stable encryption/signing key, and the
configured HTTPS public origin. There is no shared `SWIGGY_ACCESS_TOKEN` fallback.
Each Moodish account connects its own Swiggy account and selects a saved address.
See [live integration and acceptance](live-swiggy.md).

## Startup checks

With `NODE_ENV=production` and either `SWIGGY_MODE=live` or
`SWIGGY_OAUTH_ENABLED=true`, the process exits before listening unless
`DATABASE_URL`, `TOKEN_ENCRYPTION_KEY`, `GROUP_SESSION_SIGNING_KEY` and an HTTPS
`MOODISH_PUBLIC_URL` are set, both keys have at least 32 characters and differ,
and `DATABASE_URL` is not a transaction-mode pooler (port 6543, `pgbouncer=true`, or
a `-pooler.` hostname such as Neon's pooled endpoints). The log names the settings, never their values. Account and
cart locks are session advisory locks, so use a direct connection or session
pooling.

Optional tuning: `DATABASE_POOL_MAX` (default 10) sets connections per app
process. At most two fewer than that run account locks at once, so ordinary
requests always have a connection even while cart confirmations wait on
Swiggy. `MOODISH_LOCK_WAIT_MS` (default 15000) bounds how long a request waits
for a busy account or a free lock slot before it gets a "try again" answer;
`DATABASE_CONNECT_TIMEOUT_MS` (default 15000) does the same for connections.
A request waiting for a busy lock does not hold a database connection while it
waits. `GOOGLE_HTTP_TIMEOUT_MS` (default 10000) bounds each call to Google
during sign-in; a timeout returns the person to the app with a retry message.

Production verifies the database TLS certificate. A database reachable only on a
private network without TLS must say so explicitly with `?sslmode=disable` in
`DATABASE_URL`; otherwise every database request fails and `/health/ready`
returns 503.

## Runtime Secrets

Use Myprod's **Secrets & registry** for runtime secrets. Save and apply them;
the next deployment uses the applied version. Workers have no persistent volumes.
The legacy `/etc/poolctl/apps/moodish.env` mount is not needed for managed secrets.

Required production secrets:

```env
DATABASE_URL=postgresql://...
TOKEN_ENCRYPTION_KEY=...
GROUP_SESSION_SIGNING_KEY=...
OPENROUTER_API_KEY=...
```

Optional secrets, depending on enabled integrations:

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
SLACK_SIGNING_SECRET=...
SLACK_CLIENT_ID=...
SLACK_CLIENT_SECRET=...
DISCORD_PUBLIC_KEY=...
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
TEAMS_APP_ID=...
TEAMS_CLIENT_SECRET=...
```

## Myprod Handoff Manifest

```text
name: moodish
source commit: use the Git commit deployed from main
image: ghcr.io/blackdragoon26/moodish:<commit-sha>
image digest: fill from the GitHub Actions build output
architecture: linux/arm64, linux/amd64
container port: 8787
health path: /health
recommended CPU MHz: 500
recommended memory MB: 768
ephemeral data behavior: generated process state is disposable; durable app data uses DATABASE_URL
required environment variables: NODE_ENV, HOST, PORT, MOODISH_WEB_PORT, SWIGGY_MODE, SWIGGY_OAUTH_ENABLED, AI_PROVIDER, OPENROUTER_MODEL, AI_PROVIDER_TIMEOUT_MS, MOODISH_PUBLIC_URL, TEAMS_TENANT_ID
required secrets: DATABASE_URL, TOKEN_ENCRYPTION_KEY, GROUP_SESSION_SIGNING_KEY, OPENROUTER_API_KEY
publicly pullable without authentication: yes, after the GHCR package is made public
local container smoke command: docker run --rm -p 8787:8787 --env-file .env.local ghcr.io/blackdragoon26/moodish:<commit-sha>
health-check result: curl -fsS http://127.0.0.1:8787/health
project test command and result: npm test
known limitations: live Swiggy MCP remains gated by Swiggy approval; real checkout is intentionally not implemented
```

## Staged live rollout

1. Deploy the candidate with `SWIGGY_MODE=fixture` and `SWIGGY_OAUTH_ENABLED=false`.
   Check `/health` and `/health/ready`.
2. Set `SWIGGY_OAUTH_ENABLED=true` (still fixture). Connect the intended test
   account through the production callback. Do not choose an address yet: in
   fixture mode the app lists demo addresses only.
3. Run the read-only live acceptance harness against that account
   ([live-swiggy.md](live-swiggy.md#live-acceptance-harness)). It reads the real
   account through the live adapter and uses `MOODISH_ACCEPTANCE_ADDRESS_ID` if
   set, otherwise the first saved address. Every stage must PASS.
4. Set `SWIGGY_MODE=live`. Choose the real delivery address in the app (a demo
   address chosen earlier is reported as no longer available). Repeat personal
   and group reviews on web and both native apps. Run the single approved real
   Food cart test. Record evidence in [live-acceptance-report.md](live-acceptance-report.md).

`tests/rollout-sequence.test.mjs` exercises steps 2 to 4 against the simulated
Swiggy boundary.
5. Watch `/health/ready` and the `[Moodish] ... failed:` log lines. To stop live
   use quickly, set `SWIGGY_MODE=fixture` and apply; no data migration is needed.

## Rollback

Myprod deploys immutable digests, so roll back by redeploying the previous
digest from the Myprod dashboard, or with the same app-scoped token CI uses:

```bash
curl --fail-with-body -X POST -H "Authorization: Bearer $MYPROD_DEPLOY_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"image":"ghcr.io/blackdragoon26/moodish@sha256:<previous digest>"}' \
  https://api.sankalpjha.dev/__poolctl/api/apps/moodish/image
```

Find the previous digest in the earlier run's "Build and deploy Moodish" summary.

- Rolling back from the auth-hardening follow-up to the release before it keeps
  the server consistent: typed session and group tokens are still accepted by
  older images, and login flows in progress simply expire. **It breaks Google
  sign-in on app builds released with the follow-up**: the older server returns
  a token in the `moodish://` link, which those builds no longer accept. People
  already signed in keep their sessions. Roll forward again, or ask users to
  sign in with Swiggy, until the follow-up is redeployed.
- There are no schema migrations. Tables are created with `IF NOT EXISTS`, and
  new fields live inside existing JSON records, so older images read them.
- Swiggy credentials stay encrypted in `moodish_secret_sessions` under the same
  `TOKEN_ENCRYPTION_KEY`. Keep that key unchanged across a rollback, or every
  account must reconnect. Credentials expired by this release (`accessToken`
  null, `expiresAt` 0) read as expired in older images too.
- Cart reviews (`cart-prepare:*` records) must not be edited or deleted during a
  rollback. `attempting` and `uncertain` records are what stop a second write
  after an ambiguous update, and `done` records return the stored result. Reviews
  prepared by this release fail closed in older images, which ask the person to
  review again. Older images also require an empty-cart check that this release
  added, so prefer switching to `SWIGGY_MODE=fixture` over rolling back while
  live mode is on.
