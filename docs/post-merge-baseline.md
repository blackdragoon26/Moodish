# Post-merge baseline — September 30, 2026

Baseline for the live-release acceptance effort. It records what the merged code
does before any acceptance changes, so later results can be compared against it.

## Pinned inputs

| Item | Value |
| --- | --- |
| Commit | `a7857ef943e2c443ffe5a85fbafb39c1c008cf54` (origin/main, merge of PR #1) |
| Checkout | fresh worktree `release/live-acceptance` from `origin/main` |
| Host | macOS 26.4.1, Apple silicon |
| Node / npm | v26.4.0 / 11.17.0 (CI and the container use Node 22) |
| PostgreSQL | 16.15, disposable Docker container `postgres:16`, port 55432, database `moodish_test` |
| Flutter / Dart | 3.44.9 stable / 3.12.2 |
| Java | OpenJDK 25.0.2 |
| Xcode | 26.6 (17F113), iOS 26.5 simulator SDK |

No production database, production secret or Swiggy credential was used.

## Commands and results

| Command | Result |
| --- | --- |
| `npm ci` | OK, 0 vulnerabilities |
| `MOODISH_TEST_DATABASE_URL=postgresql://postgres:***@127.0.0.1:55432/moodish_test npm test` | 64 tests, 64 pass, 0 fail, 0 skipped |
| `npm test` (no database variable) | 64 tests, 63 pass, **1 skipped** (the cross-process PostgreSQL test) |
| `npm run smoke` | OK; `checkoutBlocked: true` |
| `flutter pub get && flutter analyze` | No issues found |
| `flutter test` | 2 tests, all passed (`widget_test.dart`, `api_auth_test.dart`) |
| `flutter build apk --debug` | Built `app-debug.apk`; warnings: Kotlin Gradle Plugin migration (`flutter_web_auth_2`, `share_plus`), SDK XML version mismatch |
| `xcodebuild -scheme Moodish -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build` | BUILD SUCCEEDED, 1 warning |

Read-only production probes (GET/unsigned POST, no data access):
`/health` reports `swiggyMode: fixture`; `/api/auth/config` reports Google login
enabled, Swiggy OAuth disabled, demo access enabled. The Slack, Discord and Teams
event and OAuth routes all return 503 (not configured).

## Native automated test inventory

- Android: one widget boot test and one API header test. No integration tests,
  no OAuth callback tests, no cart review tests.
- iOS: no test target. Compilation is the only automated check.
- Web: server-level route tests only. No browser automation.

## Defects found at baseline

### Pre-existing defects (present in `a7857ef`, confirmed by reproduction)

| ID | Severity | Location | Defect |
| --- | --- | --- | --- |
| D1 | High | `services/agent/src/server.mjs` `/mcp` | Outside live mode, `/mcp` accepts every tool with caller-supplied arguments. Anyone who knows a group session id and its creator id can read all private participant submissions (`get_group_meal_session` with `actorId`), bypass the invite passcode (`bypassInvitePasscode: true`), rank, select, cancel or confirm. Demo creators share `demo:moodish`; Slack creator ids are visible to workspace members. Production currently runs in fixture mode. |
| D2 | High | `server.mjs` `personal()` and `GET /api/profile` | Outside live mode, an unauthenticated request can name any `userIdHash`, including a Google identity (`google:<sub>`), to read, overwrite or delete that user's taste profile, feedback and meal memory. Production has Google login enabled in fixture mode. |
| D3 | High | `swiggy-gateway.mjs` `normalizeAddresses` | Official `get_addresses` returns `addressLine`, `addressTag`, `addressCategory` and `phoneNumber`. The normalizer spreads the raw record, so phone numbers reach web/native clients and are persisted inside stored recommendations. `addressLine` is not mapped, so the displayed address is empty. Only the first page (max 10) is read. |
| D4 | High | `cart-preparation.mjs`, `swiggy-gateway.mjs` | Official `update_food_cart` "adds or updates items" in the existing cart. The review tells the user the existing cart is replaced, and confirmation then compares the merged cart to the requested items only, so a successful write into a non-empty cart is reported as a mismatch and left uncertain. |
| D5 | Medium | `server.mjs` Swiggy callback | Cancellation, denial, expired state or a wrong browser return a raw JSON error at the callback. Browsers are stranded on a JSON page; native Custom Tab / ASWebAuthenticationSession flows never return to `moodish://`, so the app cannot show the reason. |
| D6 | Medium | `swiggy-gateway.mjs` `normalizeRestaurantMenu`, `normalizeRestaurants`, `normalizeProducts` | One record without an id makes the whole menu, restaurant list or Instamart result fail. Menu search already skips malformed rows; the others do not. An unrecognized top-level shape silently becomes an empty list. |
| D7 | Medium | `swiggy-client.mjs` | Any 401 deletes the account's connection record. A request that started with an older token can delete a connection made after it (reconnect race). |
| D8 | Low | `swiggy-client.mjs` | Timeouts, malformed results and generic upstream errors share one 502 message and no machine-readable code, so the clients cannot tell timeout, malformed response and denial apart. |
| D9 | Low | `platform-oauth.mjs` | Platform manager OAuth does not check that the session belongs to the same platform as the OAuth provider. |

### Missing infrastructure

- The cross-process PostgreSQL test skips silently when `MOODISH_TEST_DATABASE_URL`
  is missing, including in a misconfigured CI job.
- No reusable fake Swiggy MCP server with fault injection. The existing live tests
  inline a mock, which makes negative cases hard to add.
- No opt-in live acceptance harness. Previous live checks used an untracked
  diagnostic script.
- No browser automation, iOS test target, or Flutter OAuth/cart tests.
- CI does not run Flutter tests, the APK build or the iOS build.

### Documentation drift

- README still says live Swiggy MCP is not implemented and ordering uses a demo
  catalog only. The merged live integration is gated, not absent.
- `docs/group-testing.md` still points to the legacy `/etc/poolctl` secret file.

Later phases fix D1–D9 and record the results in `docs/live-acceptance-report.md`.
