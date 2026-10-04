# Moodish repository audit — 4 October 2026

Audited current main after PR #27, focusing on credential changes, prepared cart writes, PostgreSQL TLS and persistence, provider capability discovery and availability normalization.

## Fixed

- A reconnect during cart preflight could change the account used for the write. Live gateways now pin a connection version, check it before each provider tool call, and use that pinned version when preparing reviews. Confirmation rechecks before recording a write attempt.
- PostgreSQL connection-string SSL parameters could override the explicit verification/CA object. The pool now strips driver SSL overrides and applies Moodish's verification policy explicitly. The official Supabase CA remains scoped to provider hosts.
- PostgreSQL-backed profiles, recommendations, groups, feedback, history, platform responses and audit logs retained growing process-memory copies. Persistent deployments now use PostgreSQL as the source of truth for these records.
- Team preferences and clearing team history were not durable. They now use a new additive `moodish_team_profiles` table. Existing process-only preferences are not recovered automatically.
- Provider tool pagination could repeat forever. Cursor cycles and more than 32 pages now fail without executing a tool.
- Numeric unavailable flags and negative menu prices could pass cart review. Both now fail availability checks.

## Verification

Targeted reproductions cover account switching, real pg option parsing, repeated capability cursors, numeric stock flags and team preferences across fresh processes. The final PostgreSQL suite passed 160 tests (4 optional checks skipped); all 10 browser journeys passed. Tests were run against disposable local data and simulated Swiggy endpoints. No real cart or order was changed.

## Remaining evidence and feature limits

Production Swiggy callback approval is pending in Swiggy issue #132. Authenticated provider payload validation, final bill parity and one approved Food cart update cannot be verified before approval. Web browser journeys passed, but physical iOS/Android journeys remain unverified. Required dish customization is rejected safely rather than offering a picker. A stable standalone Swiggy identity needs a verified provider identity contract; Google sign-in remains the existing stable identity path. Co-manager address visibility remains an explicit product decision tracked in #14.

These outstanding items are not represented as completed by mock or fixture tests. Live mode stays off pending acceptance.
