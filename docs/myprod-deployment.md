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
- Health path: `/health`
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
