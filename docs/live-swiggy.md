# Moodish Live Swiggy MCP Integration Notes

The local product runs with `SWIGGY_MODE=fixture`, which is not live Swiggy data. To wire live Swiggy access:

1. Complete Swiggy Builders onboarding.
2. Set `MOODISH_PUBLIC_URL` and `TOKEN_ENCRYPTION_KEY`.
3. Call `/api/swiggy/oauth/start`, open the returned authorization URL, and complete phone/OTP consent.
4. The callback exchanges the PKCE code and stores the encrypted, five-day access session server-side.
5. Set `SWIGGY_MODE=live` after authenticated staging calls pass.

The live gateway maps Food `get_addresses`, `search_menu`, `search_restaurants`, `get_restaurant_menu`, and `update_food_cart`, plus Instamart `search_products`. It normalizes live and fixture responses into the same recommendation types.

The gateway already centralizes retries, rate-limit readiness, and error normalization. Keep all live tool calls behind that module so safety and telemetry remain enforceable.

Do not add a live checkout/order tool until the UI has a separate confirmation screen and the backend enforces check-then-retry behavior for non-idempotent order placement.
