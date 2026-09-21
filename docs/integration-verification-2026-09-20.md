# Integration verification — September 20, 2026

Branch: `feat/live-swiggy-integration`.

Verified:
- Swiggy DCR accepted the canonical production callback with HTTP 201 and a
  client identifier on September 20. This verifies registration only, not phone
  consent or authenticated access. No credentials are included in this report.
- All 62 backend tests passed with PostgreSQL enabled after the final API, group
  locking and cart changes.
- A separate PostgreSQL test passed with two app processes: persisted records,
  exactly-once state consumption, serialized updates and 15 nested concurrent
  lock scopes without pool exhaustion. CI now runs this test with PostgreSQL.
- iOS simulator Debug build passed with signing disabled.
- Android analyzer reported no issues; the existing widget test passed.
- Android Debug APK build passed. An earlier build ran out of disk space; the
  successful retry ran after free space became available. Build warnings remain
  about Flutter plugin Kotlin migration and Android SDK tool-version mismatch.
- The local fixture web app loaded and produced meal recommendations. Expected
  controls rendered with no framework error overlay. The new connection panel
  displayed a selected saved address using explicitly mocked HTTP responses.

Not verified:
- Production canonical callback consent, live menu/cart payloads, and Instamart
  access for the intended account.
- OAuth and cart interaction on a physical iOS or Android device.
- Slack/Teams/Discord end-to-end callbacks with each configured real workspace.
- A confirmed real Food cart update. No real cart or order was created by these
  checks; all cart mutation tests used mocks.

Deployment gates and known limitations are in [live-swiggy.md](live-swiggy.md).
