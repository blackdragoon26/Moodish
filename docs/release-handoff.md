# Release handoff: live Swiggy acceptance

Everything below is merged to `main` and deployed (fixture mode): the acceptance
work (#2), auth hardening (#3, #19), participant tokens (#17), the pool and lock
fixes (#18), and the post-merge review fixes (#23). Open follow-ups are GitHub
issues #5–#16 and #24.

Evidence: [live-acceptance-report.md](live-acceptance-report.md). Baseline:
[post-merge-baseline.md](post-merge-baseline.md).

## Status

- **Code-ready for the defined scope.** CI runs the backend suite (in memory and
  on PostgreSQL, including a brand-new database), browser journeys, Flutter and
  iOS tests on every push to `main`.
- **Not production-ready for live mode.** Nothing has been verified against a real
  Swiggy account, a real cart, or a physical device (#5, #7, #8).
- **Ship new app builds (#13).** Production now requires the PKCE code exchange
  for phone Google sign-in; app builds from before #3 can't start one.

## Production settings to confirm

In Myprod's **Secrets & registry**:
- `DATABASE_URL` is a direct or session-pooled connection. Add `?sslmode=disable`
  only for a private-network database without TLS.
- Optional tuning: `DATABASE_POOL_MAX`, `MOODISH_LOCK_WAIT_MS`,
  `DATABASE_CONNECT_TIMEOUT_MS`, `GOOGLE_HTTP_TIMEOUT_MS` (see
  [myprod-deployment.md](myprod-deployment.md)).
- Readiness is at `/health/ready`.

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
- Whether co-managers should see the creator's delivery address (#14).
- Later features, not release blockers: a customization picker (#15) and a
  durable identity for standalone Swiggy login (#16).
