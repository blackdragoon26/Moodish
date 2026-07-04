# Moodish

Moodish is a provider-agnostic AI/MCP product scaffold for Swiggy Builders Club. It combines a personal "surprise me" food concierge with an office lunch planner.

The default mode is fully local and safe: a clearly labeled fixture catalog, deterministic ranking, no real ordering, and mock AI summaries. Live Swiggy MCP and real AI providers are config-driven extension points.

## What It Builds

- Web app: planner UI for solo meals, office lunches, taste memory, cart review, and health.
- Agent service: HTTP API plus MCP-style JSON-RPC tools for `plan_personal_meal`, `plan_office_lunch`, `build_confirmed_cart`, `record_meal_feedback`, and `get_taste_memory`.
- Swiggy gateway: fixture adapter by default, live adapter boundary for Food and Instamart MCP.
- Safety layer: no cart build without recommendation id; no checkout/order placement implemented without explicit confirmation.
- Go profile service: production-style profile, team, feedback, telemetry, and privacy APIs.
- Tests: ranking, dietary/budget constraints, office aggregation, and safety gates.

## Run Locally

```bash
npm test
npm run smoke
npm run dev
```

Open the web app after `npm run dev`:

```bash
http://127.0.0.1:8787
```

`npm run dev` serves both the UI and API from the same local server, so the buttons work without opening a second terminal. `npm run agent` is available only if you want the API service by itself.

## Configuration

Copy `.env.example` to `.env.local` when you are ready to wire live providers.

- `SWIGGY_MODE=fixture|live`
- `AI_PROVIDER=mock|openrouter|openai|anthropic|local|custom`
- `SWIGGY_ACCESS_TOKEN` for live Swiggy MCP bearer-header mode
- `AI_PROVIDER_ENDPOINT` for a custom or local model gateway
- `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` when `AI_PROVIDER=openrouter`
- `AI_PROVIDER_TIMEOUT_MS` to keep recommendation responses from waiting too long on a model provider

When a real AI provider is configured and fails, Moodish returns the provider error instead of silently pretending inference worked. Recommendation responses include a `transparency` object with mood intent tags, candidate ranking, and the exact AI prompt/response trace.

OpenRouter example:

```bash
AI_PROVIDER=openrouter OPENROUTER_API_KEY=... npm run dev
```

Never commit `.env.local` or pasted provider keys. Rotate a key if it was shared in chat or logs.

## Deploy

Moodish is a Node web service, not a static GitHub Pages app. The repo includes `render.yaml` for Render Blueprint deployment.

1. Push this repo to GitHub.
2. In Render, create a new Blueprint from the repository.
3. Keep `SWIGGY_MODE=fixture` until Swiggy grants live MCP access.
4. Set `AI_PROVIDER=openrouter` and add `OPENROUTER_API_KEY` as a secret env var when testing real inference.

The production entrypoint is `npm start`, and `/health` is the health check.

## Production Notes

Moodish should remain honest about Swiggy attribution, user consent, and order safety. The app is designed to compose Swiggy Food and Instamart MCP tools, not hide or resell access.
