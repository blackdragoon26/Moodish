# Moodish

Moodish is a mood-based food planning app for Swiggy-style ordering.

You tell it what you feel like eating, your budget, and dietary needs. Moodish returns a short ranked list of meal options, explains why each option was picked, and lets you build a cart only after you choose an option.

Live app: https://moodish.onrender.com/

## What It Does

- Plans a solo meal from a mood like `rainy spicy biryani craving`.
- Plans office lunch for a small team with headcount, budget, and dietary rules.
- Uses OpenRouter for the AI summary when configured.
- Shows a transparent recommendation trace: mood tokens, ranking scores, AI prompt, and AI response.
- Keeps ordering safe: cart build requires confirmation, and real checkout/order placement is not implemented.

## Important Note

Moodish currently uses a local fixture catalog for Swiggy-like restaurant and Instamart data.

That means:

- Recommendations and cart previews are functional.
- OpenRouter AI inference is real when `AI_PROVIDER=openrouter` is configured.
- Real Swiggy MCP ordering is not live yet.
- `SWIGGY_MODE=live` is reserved for when Swiggy grants live MCP access.

## How It Works

```text
Mood input
  -> intent tags
  -> fixture/live Swiggy search
  -> budget and dietary filtering
  -> ranked shortlist
  -> AI summary
  -> confirmed cart preview
```

The AI does not secretly pick the restaurant. The deterministic recommender ranks options first. The AI writes a summary, and Moodish shows the full trace so the result is inspectable.

## Run Locally

```bash
npm install
npm test
npm run smoke
npm run dev
```

Open:

```text
http://127.0.0.1:8787
```

## Environment

Create `.env.local` from `.env.example`.

For real AI summaries:

```bash
SWIGGY_MODE=fixture
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=your_openrouter_key
OPENROUTER_MODEL=openai/gpt-4o-mini
AI_PROVIDER_TIMEOUT_MS=4500
```

Do not commit `.env.local` or API keys.

## Deploy

This is a Node web service. The repo includes `render.yaml` for Render.

1. Push the repo to GitHub.
2. Create a Render Blueprint from the repo.
3. Add `OPENROUTER_API_KEY` as a secret env var.
4. Keep `SWIGGY_MODE=fixture` until live Swiggy MCP access is available.

Production command:

```bash
npm start
```

Health check:

```text
/health
```

## Tests

```bash
npm test
npm run smoke
```

The tests cover mood ranking, dietary filtering, AI failure behavior, cart safety, and the web/API server.
