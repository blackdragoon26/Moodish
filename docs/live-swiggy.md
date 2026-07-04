# Moodish Live Swiggy MCP Integration Notes

The local product runs with `SWIGGY_MODE=fixture`, which is not live Swiggy data. To wire live Swiggy access:

1. Complete Swiggy Builders onboarding and OAuth setup.
2. Configure OAuth 2.1 with PKCE in the web app login flow.
3. Store access tokens server-side only.
4. Set `SWIGGY_MODE=live` and provide the server-side session token through the gateway.
5. Map official Swiggy Food and Instamart tool names into `services/agent/src/swiggy-gateway.mjs`.

The gateway already centralizes retries, rate-limit readiness, and error normalization. Keep all live tool calls behind that module so safety and telemetry remain enforceable.

Do not add a live checkout/order tool until the UI has a separate confirmation screen and the backend enforces check-then-retry behavior for non-idempotent order placement.
