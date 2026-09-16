# Myprod Deployment

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

Keep `SWIGGY_MODE=fixture` until Swiggy grants live MCP OAuth access and whitelists the production redirect URI.

## Runtime Secrets

Do not paste secrets into the Myprod dashboard. Install them on the target node in the app-specific runtime env file:

```text
/etc/poolctl/apps/moodish.env
```

Myprod mounts that file read-only into the container at:

```text
/run/secrets/cutable.env
```

Moodish loads that file automatically when it exists. Required production secrets:

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
SWIGGY_ACCESS_TOKEN=...
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
