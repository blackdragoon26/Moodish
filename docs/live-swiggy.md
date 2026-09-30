# Moodish live Swiggy integration

## Implemented scope

Web, iOS and Android use the same authenticated API. Personal discovery and group
ranking use the purchasing account's connection and selected saved address. Food
cart updates require a fresh server review and explicit confirmation. Instamart
products remain suggestions/preview only. Ordering, payment, Dineout, address
creation/deletion, and Instamart cart mutation are not enabled.

The client uses the official MCP SDK: initialize, capability discovery, current
input-schema validation, then an allowlisted tool call. It checks JSON-RPC,
`isError`, and embedded `success:false` failures. Read calls have bounded retries;
Food cart mutations are never automatically retried. No fixture data is inserted
into a live response. Instamart failures can leave Food results usable with a
service warning.

## Account connection

1. Configure `MOODISH_PUBLIC_URL`, `TOKEN_ENCRYPTION_KEY`,
   `GROUP_SESSION_SIGNING_KEY`, `DATABASE_URL`, and `SWIGGY_OAUTH_ENABLED=true`.
2. Browser: open `/api/auth/swiggy/start`. Existing Google/Moodish identity is
   preserved; a standalone Swiggy login creates a Moodish identity.
3. Native: POST `/api/swiggy/oauth/start` with a SHA-256 `mobileChallenge`. Open
   the returned authorization URL. The callback returns a one-minute code through
   `moodish://auth-callback?code=…`. Exchange it with the original verifier at
   `/api/auth/mobile/exchange`; store the Moodish token in Keychain/secure storage.
4. Canonical callback: `/api/auth/swiggy/callback`. The server fixes this URI from
   configuration; clients cannot override it. Browser flows are cookie-bound;
   state is encrypted, expiring, persisted, and atomically consumed once.
5. GET `/api/swiggy/connection`, then `/api/swiggy/addresses`. POST the selected
   `addressId` to `/api/swiggy/address`. POST `/api/swiggy/disconnect` to unlink.
6. A failed callback never shows a raw error page. Browser flows return to
   `/?swiggy_error=<reason>` and native flows to `moodish://auth-callback?error=<reason>`,
   where the reason is one of `declined`, `expired`, `browser_mismatch`,
   `exchange_failed` or `failed`. Provider text is never reflected.

Addresses expose only `id`, `label` and `display`. Swiggy's address records also
include the account's phone number; Moodish drops it at the adapter. A 401 from
Swiggy expires only the credential that was rejected, so the account shows
"expired". A reconnect starts fresh and the address is chosen again, because it
may be a different Swiggy account.

In the native flow, the Swiggy credential stays in the single-use exchange
record until the app that started the flow redeems the code with its PKCE
verifier. Approving consent in some other browser connects nothing unless that
browser's `moodish://auth-callback?code=` link is also handed to the app that
holds the verifier, so treat that link like a password.

Swiggy access tokens never reach the clients. They are encrypted in PostgreSQL under
the shared `TOKEN_ENCRYPTION_KEY`, with separate records for each account. Use a direct PostgreSQL connection or session pooling;
transaction-mode poolers are incompatible with the session advisory locks. Expiry uses Swiggy's `expires_in`; no unsupported refresh
flow is assumed. A shared environment access token is not supported. A standalone
Moodish identity lives in its signed app session; clearing that session currently
creates a new identity on the next standalone login. Google login provides stable
account identity across fresh devices.

## Cart contract

POST `/api/cart/prepare` with recommendationId, optionId, optional restaurantId,
and addOnProductIds. Ownership, saved address, current menu, stock, prices, and
existing cart are validated. Multi-restaurant plans require selecting one
restaurant; all other plans remain previews. The review expires in five minutes.

Swiggy's `update_food_cart` adds to the existing cart rather than replacing it.
So a review of a live account whose Food cart already has items returns
`canConfirm: false` with a `blockedReason`, shows that cart, and cannot be
confirmed; the person clears or checks out that cart in Swiggy first. This keeps
Moodish from producing a mixed cart it never showed. The documented add
semantics still need confirming in the approved real cart test.

After displaying delivery address, dishes/quantities, the item estimate and the
no-order disclosure, POST `/api/cart/confirm` with the same selection,
preparationId, and `confirmed:true`. The server serializes by account, checks the
connection version, saved address, menu, prices, stock and current cart again,
marks the attempt durably before mutation, then reads back the actual Food cart
and verifies the contents. Completed retries reuse the stored result. An
ambiguous failure is recorded as `uncertain` and never replays the write; the
person reviews the current Swiggy cart before preparing another change.

Review fingerprints are key-order independent because reviews round-trip through
PostgreSQL JSONB. Upstream failures carry a code: `SWIGGY_TIMEOUT`,
`SWIGGY_TOOL_ERROR`, `SWIGGY_MALFORMED_RESPONSE`, `SWIGGY_ACCESS_DENIED`,
`SWIGGY_RATE_LIMITED`, `SWIGGY_CAPABILITY_UNAVAILABLE`, `SWIGGY_SCHEMA_MISMATCH`,
`SWIGGY_REAUTH_REQUIRED` or `SWIGGY_UNAVAILABLE`. Only transient reads are retried.

Dishes requiring variant selection or required addons are currently rejected with
an actionable error. A customization picker is not implemented. Item estimates
are not a promised final bill; the returned Swiggy cart total is authoritative.

## Group and platform flows

Web/native group creation derives the creator and purchasing account from the
signed-in Moodish user. Slack/Teams/Discord continue using their verified webhook
and platform-manager OAuth paths. The verified creator signs into Moodish, connects
Swiggy, selects an address, and calls POST `/api/group-sessions/:id/connect` using
both the group token and personal session. The web UI resumes that manager session
after login. Co-managers can rank/select but cannot bind or confirm a cart.

Creator-only `/prepare-cart` and `/confirm-cart` mirror the personal two-stage
review. All group participants' private preferences remain restricted to managers.
A failed ranking returns to collecting so the creator can fix the connection.

## Live acceptance harness

Read-only checks for one connected account, run where the app's database and
encryption key are available (for example a one-off job on the deployment):

```bash
MOODISH_LIVE_ACCEPTANCE=1 DATABASE_URL=... TOKEN_ENCRYPTION_KEY=... \
MOODISH_ACCEPTANCE_USER_ID=<moodish user id> npm run acceptance:live -- --out report.json
```

Stages: connection, addresses, food-search, menu-detail, current-cart, instamart.
The harness uses the app's own live gateway (the same address pagination,
normalization and usable-dish filtering) with writes refused. Each stage is
PASS, FAIL or BLOCKED with an outcome (success, expired, denied, unavailable,
malformed, timeout, tool-error, unusable, blocked). Search and menu pass only
with at least one priced, in-stock item; rows the app cannot use are FAIL
(`unusable`), and no matches for the query are BLOCKED. The address is
`MOODISH_ACCEPTANCE_ADDRESS_ID` if set, else the address chosen in the app if
the account still has it, else the first saved address. The report contains
counts, flags and codes only, plus a short account fingerprint; it never prints
tokens, ids, names or addresses. It never calls `update_food_cart`. Exit codes:
0 PASS, 2 BLOCKED, 1 FAIL. `--capture-shapes <dir>` writes value-free payload
shapes for contract fixtures; review them before committing.
`MOODISH_ACCEPTANCE_QUERY` and `MOODISH_ACCEPTANCE_INSTAMART_QUERY` change the
search terms. Contract tests use documented shapes in
`tests/fixtures/swiggy-documented-shapes.json` until live shapes are captured.

## Deployment acceptance (still required)

Status and evidence: [live-acceptance-report.md](live-acceptance-report.md).

Before enabling production live mode:

- Complete OAuth using the canonical production callback with the intended account.
- Run the live acceptance harness; every stage must PASS.
- Restart the app and confirm persisted connection/state survives.
- Verify a second account cannot retrieve or mutate the first account's data/cart.
- Exercise personal and group reviews on web, iOS and Android.
- With the user's specific confirmation, update one Food cart and verify its actual
  contents/total in Swiggy. No order should be placed.
- Exercise denial, expiry, revoked access, changed cart, and partial Instamart failure.

Slack, Teams and Discord are not configured in production and are not part of
this release; their adapters are covered only by local tests.

`npm test`, `npm run test:postgres` and `npm run test:e2e` cover the mocked
protocol, auth isolation, cart retry safety and browser journeys. They do not
replace the live acceptance steps above. Do not label this release fully
verified until these are recorded with redacted evidence.

Official contracts checked September 19 and again September 30, 2026:
- https://mcp.swiggy.com/builders/docs/reference/food/search_menu/
- https://mcp.swiggy.com/builders/docs/reference/food/get_restaurant_menu/
- https://mcp.swiggy.com/builders/docs/reference/food/get_food_cart/
- https://mcp.swiggy.com/builders/docs/reference/food/update_food_cart/
- https://mcp.swiggy.com/builders/docs/reference/instamart/search_products/
- https://mcp.swiggy.com/builders/docs/reference/food/get_addresses/
