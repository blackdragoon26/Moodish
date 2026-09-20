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

Swiggy credentials never reach the clients. They are encrypted in PostgreSQL under
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

After displaying delivery address, dishes/quantities, item estimate, existing-cart
replacement and the no-order disclosure, POST `/api/cart/confirm` with the same
selection, preparationId, and `confirmed:true`. The server serializes by account,
checks the menu/cart again, marks the attempt durably before mutation, then reads
back the actual Food cart and verifies the contents. Completed retries reuse the
stored result. An ambiguous failure never replays the write automatically.

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

## Deployment acceptance (still required)

The September 18 localhost diagnostic verified DCR, token exchange, Food initialize,
tool listing and a get_addresses response. It did not verify production callback
approval, real menu normalization, Instamart access, or cart mutation.

Before enabling production live mode:

- Complete OAuth using the canonical production callback with the intended account.
- Verify addresses, dish search, menu detail and Instamart suggestions with real data.
- Restart the app and confirm persisted connection/state survives.
- Verify a second account cannot retrieve or mutate the first account's data/cart.
- Exercise personal and group reviews on web, iOS and Android.
- With the user's specific confirmation, update one Food cart and verify its actual
  contents/total in Swiggy. No order should be placed.
- Exercise denial, expiry, revoked access, changed cart, and partial Instamart failure.
- Verify each configured platform's identity callback and creator connection flow.

`npm test` covers mocked protocol, auth isolation and cart retry safety. Native builds
and fixture browser checks do not replace the live acceptance steps above. Do not
label this release fully verified until these are recorded with redacted evidence.

Official contracts checked September 19, 2026:
- https://mcp.swiggy.com/builders/docs/reference/food/search_menu/
- https://mcp.swiggy.com/builders/docs/reference/food/get_restaurant_menu/
- https://mcp.swiggy.com/builders/docs/reference/food/get_food_cart/
- https://mcp.swiggy.com/builders/docs/reference/food/update_food_cart/
- https://mcp.swiggy.com/builders/docs/reference/instamart/search_products/
