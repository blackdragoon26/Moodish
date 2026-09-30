# Release handoff: live Swiggy acceptance

PR: https://github.com/blackdragoon26/Moodish/pull/2 (`release/live-acceptance`).
Evidence: [live-acceptance-report.md](live-acceptance-report.md). Baseline:
[post-merge-baseline.md](post-merge-baseline.md).

## Status

- **Code-ready for the defined scope.** CI runs the backend suite (in memory and
  on PostgreSQL, including a brand-new database), browser journeys, Flutter and
  iOS tests. An independent reviewer passed the auth, cart and persistence changes.
- **Not production-ready for live mode.** Nothing has been verified against a real
  Swiggy account, a real cart, or a physical device.

## What merging does

Every push to `main` tests, builds and deploys to Myprod. Merging this PR deploys
it with the current settings (`SWIGGY_MODE=fixture`, `SWIGGY_OAUTH_ENABLED=false`).
That fixes two isolation defects that affect production today:
- anonymous callers could read or delete another account's taste memory;
- `/mcp` exposed private group preferences.

Before merging, confirm in Myprod's **Secrets & registry** that:
- `DATABASE_URL` is a direct or session-pooled connection. Add `?sslmode=disable`
  only for a private-network database without TLS.
- Readiness can be checked at `/health/ready` after the deploy.

## Enabling live mode (owner actions)

Follow the staged rollout in [myprod-deployment.md](myprod-deployment.md#staged-live-rollout):

1. Set `SWIGGY_OAUTH_ENABLED=true` (keep `SWIGGY_MODE=fixture`). The app refuses
   to start unless `TOKEN_ENCRYPTION_KEY` and `GROUP_SESSION_SIGNING_KEY` are set,
   at least 32 characters each, and different from each other.
2. Connect your Swiggy account through the production callback. Don't choose an
   address yet.
3. Run the read-only live check on the deployment and share the JSON report:
   `MOODISH_LIVE_ACCEPTANCE=1 MOODISH_ACCEPTANCE_USER_ID=<your Moodish id> npm run acceptance:live -- --out report.json`.
   It prints counts and codes only, never ids or tokens.
4. Set `SWIGGY_MODE=live`, choose your real address, and try the web, iOS and
   Android flows. Test the phone apps on physical devices.
5. Approve the one real Food cart test: account, address, dish and quantity
   (procedure in the report). Your Swiggy Food cart must be empty. No order is
   placed.

To leave live mode at any time, set `SWIGGY_MODE=fixture`. To roll back an image,
see [myprod-deployment.md](myprod-deployment.md#rollback). Keep
`TOKEN_ENCRYPTION_KEY` unchanged, and never delete `cart-prepare:*` records.

## Decisions for the owner

- Slack, Teams and Discord are unconfigured and unsupported for this release.
- Follow-up auth hardening is in a separate PR (see below).
- Later features, not release blockers:
  - a customization picker for dishes that need options;
  - durable identity for standalone Swiggy login;
  - wider platform availability.

## Follow-up work (separate PR, `followup/auth-hardening`)

Stacked on this PR; merge it after this one. It resolves:
- The Google login on phones still returns the session token in the
  `moodish://` URL, without a verifier.
- Google and platform OAuth flows are held in process memory.
- Unredeemed OAuth and exchange records are never pruned.
- Auth session and group tokens share a signing key, with no type claim.
- The iOS Keychain wrapper ignores write failures.
