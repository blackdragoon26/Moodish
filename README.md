# Moodish

Moodish is a provider-agnostic AI/MCP product scaffold for Swiggy Builders Club. It combines a personal "surprise me" food concierge with an office lunch planner.

The default mode is fully local and safe: mocked Swiggy responses, deterministic recommendations, no real ordering, and no AI API key required. Live Swiggy MCP and AI providers are config-driven extension points.

## What It Builds

- Web app: planner UI for solo meals, office lunches, taste memory, cart review, and health.
- Agent service: HTTP API plus MCP-style JSON-RPC tools for `plan_personal_meal`, `plan_office_lunch`, `build_confirmed_cart`, `record_meal_feedback`, and `get_taste_memory`.
- Swiggy gateway: demo adapter by default, live adapter boundary for Food and Instamart MCP.
- Safety layer: no cart build without recommendation id; no checkout/order placement implemented without explicit confirmation.
- Go profile service: production-style profile, team, feedback, telemetry, and privacy APIs.
- Tests: ranking, dietary/budget constraints, office aggregation, and safety gates.

## Run Locally

```bash
npm test
npm run smoke
npm run dev
```

Open the web app:

```bash
npm run web
```

Then visit `http://127.0.0.1:8787`.

## Configuration

Copy `.env.example` to `.env.local` when you are ready to wire live providers.

- `SWIGGY_MODE=demo|live`
- `AI_PROVIDER=mock|openai|anthropic|local|custom`
- `SWIGGY_ACCESS_TOKEN` for live Swiggy MCP bearer-header mode
- `AI_PROVIDER_ENDPOINT` for a custom or local model gateway

## Production Notes

Moodish should remain honest about Swiggy attribution, user consent, and order safety. The app is designed to compose Swiggy Food and Instamart MCP tools, not hide or resell access.
