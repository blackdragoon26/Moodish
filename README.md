# Moodish

<img src="apps/web/public/assets/moodish-logo.png" alt="Moodish logo" width="96" height="96" />

**Built for Swiggy Food + Instamart** · Powered through the [Swiggy Builders Club](https://mcp.swiggy.com/builders/)

> Swiggy trademarks and logos are used only within the live app itself; live Swiggy MCP connectivity requires credentials issued directly by Swiggy to a registered integration partner and isn't included in this repository.

Moodish is a mood-based food planning app for Swiggy-style ordering.

You tell it what you feel like eating, your maximum budget, dietary needs, and whether you want something familiar, balanced, or completely new. Moodish returns craving-first meal options, explains exact matches and alternatives, and lets you build a cart only after confirmation.

<table>
  <tr>
    <th align="center">Flutter Demo</th>
    <th align="center">Swift Demo</th>
  </tr>
  <tr>
    <td align="center">
      <video src="https://github.com/user-attachments/assets/475c01eb-8101-4944-b44e-1d57e82644ca" width="250" controls></video>
    </td>
    <td align="center">
      <video src="https://github.com/user-attachments/assets/ec6797e2-0dcc-4fbe-a2ae-dae141ec14f5" width="250" controls></video>
    </td>
  </tr>
</table>



## Apps

Moodish also ships as native mobile clients that talk to the same backend as the web app:

- **iOS** (SwiftUI) — [`apps/ios`](apps/ios). Open `Moodish.xcodeproj` in Xcode and run on a Simulator (see [docs/demo-testing-guide.md](docs/demo-testing-guide.md)).
- **Android** (Flutter) — [`apps/moodish_android`](apps/moodish_android). Download the latest APK from [Releases](https://github.com/blackdragoon26/Moodish/releases) or build it yourself with `flutter build apk`.

The main experience is now conversational: sign in, describe the mood, and Moodish asks only for missing hard constraints such as food mode and maximum budget. A complete prompt such as `spicy Chinese, non-veg, under ₹450 with a cold drink` goes directly to recommendations.

## What It Does

- Plans a solo meal from a mood like `rainy spicy biryani craving`.
- Creates private group-meal preference sessions for web, Slack, Teams, and Discord.
- Supports manager choice, team voting, or automatic ranking with creator-only cart confirmation.
- Suggests optional, separately fulfilled Instamart add-ons.
- Uses OpenRouter for the AI summary when configured.
- Lets reviewers use their own OpenRouter API key for a single browser session.
- Shows a transparent recommendation trace: mood tokens, ranking scores, AI prompt, and AI response.
- Keeps ordering safe: a Swiggy Food cart update needs a fresh server review and explicit confirmation, and checkout/order placement is not implemented.

## Important Note

Moodish defaults to a visibly labelled local demo catalog (`SWIGGY_MODE=fixture`).

- Recommendations, group sessions, voting, and cart previews work on demo data.
- OpenRouter AI inference is real when `AI_PROVIDER=openrouter` is configured.
- The live Swiggy integration is implemented behind `SWIGGY_MODE=live`: per-account
  OAuth, saved addresses, Food discovery, a reviewed and confirmed Food cart
  update, and Instamart suggestions as a preview only. No order is ever placed.
- Live mode is not enabled in production yet. It needs the live acceptance
  steps in [docs/live-swiggy.md](docs/live-swiggy.md); current evidence is in
  [docs/live-acceptance-report.md](docs/live-acceptance-report.md).
- In a live cart review, the item estimate is not the bill. Swiggy's cart total
  after the update is authoritative.

## How It Works

```text
Mood input
  -> structured craving intent
  -> dish-first fixture/live Swiggy search
  -> hard availability, maximum-budget, and dietary filtering
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

For durable profiles and group sessions:

```bash
DATABASE_URL=postgresql://...
TOKEN_ENCRYPTION_KEY=a-long-random-secret
GROUP_SESSION_SIGNING_KEY=a-different-long-random-secret
```

Google login additionally needs `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Swiggy login uses the MCP OAuth 2.1 + PKCE flow and remains disabled until Swiggy has whitelisted the deployed client and redirect URI; set `SWIGGY_OAUTH_ENABLED=true` only after that approval. Fixture deployments expose clearly labelled demo access so reviewers can test without pretending that an OAuth provider is connected.

Collaboration webhooks require platform signing credentials, and manager dashboard access requires the matching Slack, Discord, or Microsoft OAuth client credentials listed in `.env.example`. All three adapters use the same group-session service, reject unsigned requests, and bind private dashboard access to the platform identity that created or manages the session.

Do not commit `.env.local` or API keys.

Reviewers can also open Developer view in the app and paste their own OpenRouter key. That key is sent only with recommendation requests and is not stored in recommendation memory or returned in the trace.

## Deploy

This is a Node web service packaged as a non-root container for Myprod.

Every push to `main` runs the tests, publishes an immutable image and deploys it
to Myprod automatically, so merging is deploying.

1. Save and apply runtime secrets in Myprod's **Secrets & registry**.
2. Liveness is `/health`; readiness including PostgreSQL is `/health/ready`.
3. Keep `SWIGGY_MODE=fixture` until the staged live rollout in the deployment
   guide has passed.

See [docs/myprod-deployment.md](docs/myprod-deployment.md) for the exact Myprod handoff manifest and environment split.

## Recommendation Contract

Personal requests accept `mood`, `maxBudget`, `dietMode` (`veg`, `non_veg`, `both`), optional `dietaryRules` and `allergies`, `discoveryMode` (`comfort`, `balanced`, `explore`), `addressId`, and `includeInstamartAddOns`.

Legacy `budget` and numeric `novelty` remain accepted. Novelty values 1-2 map to comfort, 3 to balanced, and 4-5 to explore.

## Group Sessions

Create a group session through `POST /api/group-sessions`, privately submit preferences, close and rank the session, vote or select an option, then have the session creator explicitly confirm the cart. Public session views contain aggregate counts and never include participant allergies or private submissions.

Production command:

```bash
npm start
```

Health check:

```text
/health
```

See [the Moodish Enterprise testing guide](docs/group-testing.md) for a one-click demo-team journey, a two-browser test, production secret setup, and Slack/Teams/Discord adapter checks.

## Tests

```bash
npm test                 # backend; cross-process PostgreSQL tests need MOODISH_TEST_DATABASE_URL
npm run test:postgres    # the whole backend suite with PostgreSQL as storage
npm run test:e2e         # browser journeys (Playwright) against the real app
npm run smoke
```

Use a disposable database for `MOODISH_TEST_DATABASE_URL`, never production.
Tests simulate only the Swiggy network boundary with a fake provider
(`tests/helpers/fake-swiggy.mjs`); they never call Swiggy. Native checks:
`flutter analyze && flutter test` in `apps/moodish_android`, and
`xcodebuild test -scheme Moodish -destination 'platform=iOS Simulator,name=iPhone 17' CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO`
in `apps/ios/Moodish`.

Read-only live checks for one connected account are opt-in and never run in CI:
see `npm run acceptance:live` in [docs/live-swiggy.md](docs/live-swiggy.md).
