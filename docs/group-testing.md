# Testing Moodish Enterprise

Moodish Enterprise is the branded group-order workspace. The web demo uses the same group-session service as the Slack, Microsoft Teams, and Discord adapters.

## Fast browser test

1. Open Moodish and choose **Preview with demo access**.
2. Open **Moodish Enterprise** in the left navigation.
3. Pick headcount, budget, vibe, and decision mode.
4. Select **Launch enterprise lunch**.
5. Select **Simulate 3 teammates**. This creates three private submissions with different food modes, cravings, and an allergy.
6. You can add another response manually in the private preference form.
7. Select **Close & rank**.
8. Choose a finalist:
   - `manager_decides`: select an option and approve it.
   - `team_vote`: vote for an option, then approve the winner.
   - `automatic`: Moodish chooses the top option.
9. Select **Creator: confirm final cart**. The result is only a cart preview; checkout remains blocked.

The progress board shows aggregate counts. Private allergy and dietary details never appear in the public session view.

## Test with two browsers

1. Create a table in the first browser.
2. Copy the invite URL.
3. Open it in a private/incognito browser.
4. Submit a participant preference there. The invite is deliberately a preference page first.
5. Return to the creator browser and select **Close & rank**.
6. If the session uses **Team votes**, refresh the same participant link. It now shows the ranked meal cards and voting control.
7. Return to the creator browser to approve the winning plan.

The current web demo keeps creator authorization in the creator browser session. Platform production flows bind manager access to Slack, Microsoft, or Discord OAuth.

## Local automated tests

```bash
npm install
npm test
npm run smoke
```

The suite covers signed creator access, private submissions, group state transitions, automatic selection, team voting, adapter signatures, duplicate webhook behavior, and cart confirmation.

## Production configuration

For a Render deployment, set these environment variables:

```text
TOKEN_ENCRYPTION_KEY=<long random secret>
GROUP_SESSION_SIGNING_KEY=<different long random secret>
DATABASE_URL=<Render PostgreSQL connection>
```

The Blueprint generates both secrets for a new/synchronized service. If the existing service predates those entries, open **Render → moodish → Environment**, add the two keys, and redeploy.

Fixture mode can now create test sessions even if the keys are temporarily missing. It uses an ephemeral process key, so demo manager links expire after a service restart. Live Swiggy mode intentionally refuses that fallback.

## Slack, Teams, and Discord

Each platform needs its own installation and request-verification credentials. Configure the variables in `.env.example`, register the matching event URL, then run the adapter conformance tests:

```bash
node --test tests/platform-adapters.test.mjs tests/platform-oauth.test.mjs
```

### Slack walkthrough

1. Create an app from scratch at `https://api.slack.com/apps`.
2. Add `/moodish` under **Slash Commands**.
3. Use `https://moodish.onrender.com/api/platforms/slack/events` as the Request URL.
4. Copy the Slack Signing Secret into Render as `SLACK_SIGNING_SECRET`.
5. Add `https://moodish.onrender.com/api/platforms/slack/oauth/callback` under OAuth redirect URLs.
6. Add `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET` to Render for protected manager access.
7. Install the app, redeploy Moodish, and run `/moodish easy team lunch`.

The public Slack response contains safe aggregate progress, a private participant URL, and a manager dashboard link. Moodish validates Slack’s signature before creating a session.

Brand names used in product surfaces:

- **Moodish for Slack**
- **Moodish for Teams**
- **Moodish for Discord**
- Shared group workspace: **Moodish Enterprise**
- Meal-completion suggestions: **Moodish Pairings**
