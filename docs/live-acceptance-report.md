# Live acceptance report

Branch `release/live-acceptance`, based on `a7857ef` (PR #1 merge). Prepared
September 30, 2026. The baseline is in [post-merge-baseline.md](post-merge-baseline.md).
The independent review result is at the end of this report.

**Verdict: code-ready for the defined scope, not production-ready.** Every
deterministic gate below passes. Live Swiggy stages, physical devices and the
real Food cart update are BLOCKED on a real account connection and the owner's
approval. Nothing in this report was verified against live Swiggy data.

Status values: PASS (verified with the evidence named), FAIL, BLOCKED (applies,
but the evidence is unavailable), NOT APPLICABLE (out of scope, with reason).

## Environment

macOS 26.4.1 (Apple silicon); Node 26.4.0 locally, Node 22 in CI and the image;
PostgreSQL 16.15 in a disposable container; Playwright 1.63 (Chromium, able to
resolve only 127.0.0.1); Flutter 3.44.9; Xcode 26.6 with the iOS 26.5 simulator
(iPhone 17); Android emulator `Moodish_Pixel` (API 34). No production database,
production secret or Swiggy credential was used.

## Deterministic results

| Suite | Command | Result |
| --- | --- | --- |
| Backend, in-memory storage plus cross-process PostgreSQL | `MOODISH_TEST_DATABASE_URL=<disposable> npm test` | 117 tests: 116 pass, 1 skipped (the CI-only "database present" guard) |
| Backend on PostgreSQL | `npm run test:postgres` | 117 tests: 115 pass, 2 skipped (the CI-only guard; the no-database refusal test) |
| Missing database in CI | `CI=true npm test` without the variable | Fails (8 tests), by design |
| Smoke | `npm run smoke` | OK, `checkoutBlocked: true` |
| Browser journeys | `npm run test:e2e` | 9 of 9 pass |
| Flutter | `flutter analyze && flutter test` | No issues; 11 of 11 pass |
| Android build | `flutter build apk --debug` | Built |
| iOS unit tests | `xcodebuild test ... CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO` | 8 of 8 pass |
| iOS build without signing | `xcodebuild build ... CODE_SIGNING_ALLOWED=NO` | Succeeded |
| Container | `docker build`, then runs in live production configuration | See Operations |

The iOS Keychain test fails when the test host is unsigned
(`CODE_SIGNING_ALLOWED=NO`), because the simulator denies Keychain access
without a code signature. That is a test-environment requirement, not an app defect.

## Guard mutation check

In disposable copies of the candidate, each protection below was removed and the
relevant suites were run. The product code in the branch was never modified.

| Removed protection | Caught by |
| --- | --- |
| Account lock around cart confirmation | concurrent and cross-process confirm tests (11 failures) |
| Single-use OAuth state | replay test, three-process redemption test |
| Recommendation owner check | two-account isolation tests (cookie and native) |
| Key-order independent review digest | two-process confirmation test |
| Blocked review for a non-empty cart | non-empty cart test |
| `/mcp` personal-tool allowlist | fixture-mode `/mcp` isolation test |
| Refusal to retry an uncertain attempt | ambiguous-write test, interrupted-attempt test |
| Purchasing-account check on group carts | group credential test |
| Address field whitelist | phone-number contract test |
| Version condition on credential expiry (SQL) | not caught at first; added a PostgreSQL test, now caught |
| Version condition on credential expiry (memory) | stale-401 test |

## Test cases

Test files are under `tests/` unless noted. "e2e" means `tests/e2e/journeys.spec.mjs`.

### OAuth and connection

| Case | Status | Evidence |
| --- | --- | --- |
| Browser connect with PKCE S256 and the canonical callback | PASS | oauth-acceptance: "browser OAuth connects…" |
| Replay of a completed callback | PASS | same test; token endpoint called once |
| Wrong browser or missing flow cookie; flow not burned | PASS | oauth-acceptance: "a callback from another browser…" |
| Cancellation or denial consumes the flow; readable reason | PASS | oauth-acceptance; e2e "cancelled consent…" |
| Expired state | PASS | oauth-acceptance: "an expired OAuth state…" |
| Code from another flow fails PKCE | PASS | oauth-acceptance: "an authorization code issued for another flow…" |
| Native code: single use, verifier required, 60 s expiry | PASS | oauth-acceptance: native tests |
| Native denial returns `moodish://auth-callback?error=declined` | PASS | oauth-acceptance; Flutter `auth_callback_test.dart`; iOS `AuthCallbackTests` |
| Redirect URI fixed to the configured origin; cross-origin POST refused | PASS | oauth-acceptance; `public-origin.test.mjs` |
| Production live without a database refuses OAuth | PASS | oauth-acceptance |
| Revoked access expires only the rejected credential; status shows expired; reconnect starts fresh | PASS | oauth-acceptance; postgres-state (cross-process) |
| Native flow binds Swiggy access only after the starting app proves its verifier | PASS | oauth-acceptance: "a native flow never binds…" (defect F1 from the independent review) |
| Disconnect and reconnect create a new connection version | PASS | oauth-acceptance; e2e "disconnect and reconnect…" |
| Standalone Swiggy login creates its own identity | PASS | oauth-acceptance. Recovery after the app session is cleared is still not supported (see Limitations). |
| Production consent through the canonical production callback | BLOCKED | Needs the owner's Swiggy login |

### Isolation and roles

| Case | Status | Evidence |
| --- | --- | --- |
| Two accounts: recommendation, review, cart, connection, profile isolated (cookie and native header) | PASS | isolation: "two accounts stay isolated…" (both paths) |
| Each account's Swiggy calls use only its own token | PASS | same |
| Group token alone, another account, a participant token, a token for another session | PASS | isolation: "group purchasing operations…" |
| Co-manager can rank and select but not prepare or confirm | PASS | cart-invariants: group journey |
| Participants never see private preferences; passcode cannot be skipped | PASS | isolation: "participants cannot read…"; group-session tests |
| Fixture mode: `/mcp` cannot reach group tools; no cross-account `userIdHash` | PASS | isolation: fixture test (defects D1, D2) |

### Durable state (PostgreSQL, separate processes)

| Case | Status | Evidence |
| --- | --- | --- |
| Records and locks across processes; nested locks without pool exhaustion | PASS | postgres-state |
| OAuth state redeemed by exactly one of three processes | PASS | postgres-state |
| Two processes confirming one review write once | PASS | postgres-state |
| Connection survives restart; a reconnect invalidates older reviews | PASS | postgres-state; container restart |
| An attempt interrupted mid-write stays blocked after restart | PASS | postgres-state |
| A failing locked operation releases its lock and pool connection | PASS | postgres-state |

### Cart invariants

| Case | Status | Evidence |
| --- | --- | --- |
| Review is read-only; one confirmation writes once; Swiggy total is authoritative | PASS | cart-invariants: personal journey |
| Five concurrent confirmations write once; completed retry returns the stored result | PASS | cart-invariants |
| Expired review; changed address, connection, price, stock or current cart | PASS | cart-invariants: "stale reviews…" (no write in any case) |
| Tampered option, restaurant, add-ons or preparation id; missing confirmation | PASS | cart-invariants |
| Invalid items or quantities; required customization; multi-restaurant plan | PASS | cart-invariants (customization returns an actionable 422) |
| Non-empty Swiggy cart shown, not confirmable | PASS | cart-invariants; e2e; Flutter and iOS review tests |
| Timeout before or after a write, network error, error envelopes, HTTP 500 | PASS | cart-invariants: attempted once, never replayed, recorded as uncertain |
| Read-back differs from the review | PASS | cart-invariants |
| Group: only the purchasing creator confirms, once; retry returns the view | PASS | cart-invariants: group journey; e2e group journey |

### Swiggy contract

| Case | Status | Evidence |
| --- | --- | --- |
| Documented shapes for addresses, menu search, menu, cart, empty cart, Instamart | PASS | swiggy-contract, `tests/fixtures/swiggy-documented-shapes.json` (synthetic, written from the docs) |
| Malformed rows skipped; all-malformed or unknown shapes are errors | PASS | swiggy-contract |
| Distinct failure codes; only transient reads retried; cart writes never retried | PASS | swiggy-contract; cart-invariants |
| Missing tool or schema drift reported before any call | PASS | swiggy-contract |
| Instamart failure leaves Food usable; no fixture data in live results | PASS | swiggy-contract |
| Live payloads match the documented shapes | BLOCKED | Needs a live account; run the harness with `--capture-shapes` |

### Live acceptance harness

| Case | Status | Evidence |
| --- | --- | --- |
| Opt-in only; missing configuration is BLOCKED | PASS | live-acceptance-harness |
| Each stage reports its own outcome | PASS | live-acceptance-harness |
| No cart write, token, id, name, address or phone in the output | PASS | live-acceptance-harness |
| Live run: connection, addresses, search, menu, cart, Instamart | BLOCKED | Needs the owner's connected account |

### User journeys

| Case | Status | Evidence |
| --- | --- | --- |
| Web: connect, choose an address, live meal, keyboard confirm, reload | PASS | e2e (simulated Swiggy boundary) |
| Web: duplicate submit disabled while confirming | PASS | e2e |
| Web: stale review refused, then a fresh review succeeds | PASS | e2e |
| Web: errors and empty results shown plainly | PASS | e2e |
| Web: narrow (375 px) viewport without sideways scroll | PASS | e2e |
| Web: fixture mode labelled as demo end to end | PASS | e2e |
| Web: creator group review and confirmation | PASS | e2e |
| iOS simulator: demo sign-in, chat, recommendation, cart preview | PASS | Manual run on iPhone 17 against the local fixture server; server audit logged `build_confirmed_cart: ok` |
| Android emulator: demo sign-in, chat, recommendation, cart preview, cold restart keeps the session | PASS | Manual run on `Moodish_Pixel`; cart result screen showed "Checkout stays blocked" |
| Native personal and group credentials sent separately | PASS | Flutter `api_auth_test.dart`; iOS `APIClientSessionTests` |
| Native secure session persistence and logout | PASS | Flutter tests; iOS Keychain test |
| Native live Swiggy connection, callbacks and cart review | BLOCKED | Needs real Swiggy consent |
| Callback after the app is killed during sign-in | BLOCKED | Needs real consent; the plugin sessions cannot resume, so the person retries (the exchange code expires in 60 s) |
| Physical iPhone and Android device | BLOCKED | No hardware in this session |

### Collaboration platforms

| Case | Status | Evidence |
| --- | --- | --- |
| Forged, unsigned and stale Slack and Discord requests rejected | PASS | `platform-security.test.mjs` |
| Replayed signed Slack command returns the first response | PASS | `platform-security.test.mjs` |
| Manager OAuth hands a token only to the creator or co-manager on the same platform; state single use | PASS | `platform-security.test.mjs` |
| Teams JWT verification | NOT APPLICABLE | Teams is not configured; no automated test exists |
| Real Slack, Teams or Discord callbacks | NOT APPLICABLE | Not configured in production (all routes return 503); unsupported for this release |

### Operations

| Case | Status | Evidence |
| --- | --- | --- |
| Unsafe production configuration exits before listening, without printing secrets | PASS | config tests; container run |
| Transaction-mode pooler rejected | PASS | config tests; container run |
| Container runs as a non-root user | PASS | `id -un` is `moodish` |
| Readiness is 503 when the database is unreachable, 200 when ready | PASS | container run with TLS required, then `sslmode=disable` |
| Connection state survives a container restart | PASS | container run |
| No secrets in container logs | PASS | log search for keys, the password and session cookies found none |
| Unexpected errors return a generic message | PASS | container run (a database TLS error was logged, not returned) |
| Rollback procedure | PASS (documented, not executed) | [myprod-deployment.md](myprod-deployment.md#rollback) |

### Real Food cart update

| Case | Status | Evidence |
| --- | --- | --- |
| One approved Food cart update, checked in Swiggy | BLOCKED | Needs a live connection and the owner's specific approval |

Proposed test, which runs only after the owner approves the exact details:

1. The owner names the Swiggy account and saved address, and confirms that its
   Food cart is empty. Moodish refuses to update a non-empty cart.
2. Run the live harness for that account; every stage must PASS.
3. In Moodish (live mode), pick one dish without required customization,
   quantity 1. Before confirming, send the owner the restaurant, dish, quantity,
   item estimate and address for approval.
4. After approval, confirm once. Record the Swiggy total Moodish reports.
5. Check in the Swiggy app that the cart holds exactly that dish ×1 at that
   address and that the totals match. This also confirms whether
   `update_food_cart` adds rather than replaces.
6. Place no order. Do not clear or restore the cart without the owner's instruction.

## Defects found and fixed

Baseline defects D1–D9 are described in [post-merge-baseline.md](post-merge-baseline.md). Found later:

| ID | Severity | Defect | Fix |
| --- | --- | --- | --- |
| D10 | Critical | JSONB reorders keys, so every persisted live review was rejected as a changed menu. Found by the new two-process test. | Key-order independent fingerprints |
| W1 | Medium | Web review buttons stayed clickable during confirmation | Disabled while in flight |
| W2 | Medium | Live cart result did not say the total is Swiggy's | Labelled; estimate marked "not the final bill" |
| W3 | Medium | Recommendation cards could not be chosen by keyboard; upstream ids unescaped in HTML | Button semantics, Enter/Space, escaping |
| W4 | Low | No Food match produced "0 curated options" and an Instamart item | Plain empty-state message, no add-on |
| O1 | Medium | `/health/*` was served `index.html` with 200 | Routed to the API; readiness added |
| O2 | Medium | Production forced database TLS with no opt-out | Explicit `sslmode=disable` |
| O3 | Low | Unexpected errors, such as database errors, were returned to clients | Generic message; logged server-side |
| O4 | Low | Malformed JSON bodies returned 500 | 400 |
| O5 | Medium | The deploy workflow's test gate had no database | Disposable PostgreSQL service |
| F1 | High | Native OAuth saved the Swiggy credential to the Moodish account that started the flow at callback time, so whoever approved consent in any browser connected their Swiggy account to the starter's Moodish account. Found by the independent review. | Credential held in the single-use exchange record until the starting app proves its verifier |
| F2 | Medium | Discord requests had no timestamp freshness check; docs overstated platform test coverage | 5-minute window; real rejection, replay and handoff tests |
| F3 | Low | Docs said a reconnect keeps the chosen address; it does not | Docs corrected; behaviour kept as the safer one and tested |
| F4 | Medium | The deploy gate skipped the browser journeys | Deploy runs `test:e2e`; native checks stay in test.yml |

## Limitations and residual risks

- Nothing here is verified against live Swiggy. The contract fixtures come from the
  public docs, and live responses may differ.
- `update_food_cart` add semantics come from the docs. Moodish blocks non-empty
  carts until the real cart test confirms the behaviour.
- Participant identity in group sessions is a client-chosen name plus the shared
  passcode, so a participant who knows another's name can overwrite that
  response. This is unchanged.
- Demo users share one identity (`demo:moodish`) by design; demo data is shared.
- Auth session and group tokens are signed with the same key and told apart only
  by their payload fields. This is safe today; a type claim would be clearer.
- Google and platform OAuth flows are held in process memory, so a callback that
  reaches another replica, or arrives after a restart, fails and must be retried.
  Swiggy flows are durable.
- The iOS Keychain wrapper ignores `SecItemAdd` failures.
- Standalone Swiggy login cannot recover its identity after the app session is
  cleared (a follow-up; Google login is stable).
- A required dish customization is rejected with an explanation; there is no picker.
- Mobile Google login still returns the Moodish session token in the
  `moodish://auth-callback?token=` URL, without the PKCE-bound exchange the Swiggy
  flow uses. Another Android app registering the `moodish` scheme could
  intercept it. This is pre-existing; move it to the same exchange as a follow-up.
- Transaction-pooler detection is heuristic (port 6543, `pgbouncer=true`,
  `-pooler.` hosts). Other transaction poolers would break the advisory locks.
- A cart confirmation holds a pool connection and an account lock across several
  Swiggy calls (up to about 30 s each). Many slow concurrent confirmations can
  exhaust the pool of 10.
- Live cart checks find each item again by name with `search_menu`. An item that
  is not on the first page reads as unavailable (fails closed). Addresses are
  read up to 5 pages (50).
- Co-managers can rank plans, which reads Swiggy with the purchasing creator's
  connection, and see the creator's delivery address in the manager view.
- During test development, a missed browser intercept loaded Swiggy's public
  consent page once, using a throwaway registered test client. Nothing was
  entered or approved. The browser tests now resolve only local hosts.

## Independent review

Pending; see the reviewer section below once recorded.
