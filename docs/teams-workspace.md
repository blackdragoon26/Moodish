# Moodish for Teams

Open `/teams.html`. This workspace coordinates office meals for 2–25 people with private join/skip links, spending caps, organizer and purchaser roles, up to three checked restaurant choices, repeat meals, weekly invitations and a downloadable spending report.

## What is real, and what still needs activation

Workspace state persists in PostgreSQL using the existing secret-session store. The service creates its storage table automatically; this feature does not need the Supabase browser SDK or public Data API access. Set `DATABASE_URL` to your verified-TLS PostgreSQL connection and keep it server-only. Production team endpoints refuse non-durable storage. `/api/teams/demo` provides an isolated demo identity; Google sign-in is required before connecting a real workplace channel.

Provider tokens stay encrypted on the server. Set a stable `TOKEN_ENCRYPTION_KEY` and back it up securely before installations. Set `MOODISH_PUBLIC_URL` to the HTTPS deployment origin and configure existing Google OAuth credentials. The account login returns to the workspace or meal that initiated it.

Slack, Discord and WhatsApp require their own registered applications and credentials. They are not enabled by adding a link to the UI. Swiggy live suggestions require an authorized, connected purchaser and a selected delivery address. Production Swiggy client whitelisting is a separate approval. Fixture suggestions must not be represented as live food inventory.

This feature never places an order or charges a payment. A purchaser checks availability, dietary coverage and a fresh all-in quote before handoff, then completes the external checkout themselves. The recorded order and spend are purchaser-reported, not verified with Swiggy. Billing, reimbursements, invoice reconciliation and enterprise SSO are not implemented.

## Office workflow

1. Sign in and create an office with its address, budget per person, total cap and usual attendance. The default attendance budget must fit within the total cap.
2. The owner invites organizers or purchasers with a private, expiring invitation. Owners can revoke members and disconnect channels from the dashboard.
3. Create a meal with a response cutoff and optional delivery time. Share its join link. Each participant records their own attendance and dietary preferences privately; saving preferences on that device is optional.
4. Close responses. A connected purchaser can request live suggestions. An organizer can instead enter one to three manually checked options. Every saved choice requires an explicit confirmation that all attending participants are covered. In a manual workflow, confirm essential restrictions with participants directly; the organizer dashboard does not expose private dietary answers.
5. The purchaser checks the final quote and confirms handoff within 15 minutes of the review. Current attendance and spending caps are rechecked. External ordering remains manual.
6. The assigned purchaser records the actual reference and total. Reports clearly label these as self-reported. Repeat creates a fresh invitation with no inherited attendance or purchase confirmation.

Participants retain a private capability on their device to edit or remove their own response while permitted. Do not publish participant-specific URLs or forward role invitation links publicly. Public channel cards contain aggregate counts, cutoff, budget and a join link; they do not contain names or dietary answers.

## Slack

Create an app from `integrations/slack-manifest.json`, replacing the deployment origin if necessary. Configure `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` and `SLACK_SIGNING_SECRET` on the server. The scopes are `commands` and `chat:write`; there is no channel history access.

The OAuth redirect is `/api/teams/slack/callback`. The slash command request URL is `/api/platforms/slack/events`. An owner chooses **Install Slack**, then **Pair Slack channel**, and runs the displayed one-use connection command in the intended channel within ten minutes. The same Slack installation actor must pair it. Invite the bot to private channels where needed.

Use `/moodish lunch`, or `/moodish lunch Friday for 12 ₹350 delivery 1pm`. Explicit command times use Asia/Kolkata. Unsupported scheduling wording is rejected; use the dashboard for precise dates. Commands acknowledge privately with the meal link. The background worker publishes and updates one tracked shared card. A channel can belong to only one office.

## Discord

Configure `DISCORD_CLIENT_ID`, `DISCORD_PUBLIC_KEY` and `DISCORD_BOT_TOKEN`. Set the interactions endpoint to `/api/platforms/discord/events`. Register `integrations/discord-command.json` through Discord's application-command API. Configure credentials server-side, never in browser JavaScript.

The owner chooses **Connect Discord**, installs the bot using the displayed link, and runs `/moodish text:connect <code>` in the target channel. Then use `/moodish text:lunch`. Grant only the displayed send/view permissions in the intended channel. Shared cards suppress mentions and are updated in place.

## WhatsApp Cloud API

Configure `WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PUBLIC_NUMBER` (digits only), and a supported, pinned `WHATSAPP_GRAPH_VERSION` from your Meta app dashboard. Set the webhook URL to `/api/platforms/whatsapp/events` and subscribe to messages. The verification challenge uses `WHATSAPP_VERIFY_TOKEN`; incoming requests require Meta's valid payload signature and the configured business phone number ID.

The participant click-to-chat link sends `MEAL <teamId> <mealId> <shareToken> REMIND`. The user must send that text themselves. `REMIND` grants explicit consent for that meal's pending-response reminder; omitting it returns the private link without reminder enrollment. Replying `STOP` opts the phone out of reminders globally. This implementation does not automate WhatsApp group chats or send unsolicited outreach.

For reminders, approve a utility template containing exactly one body text parameter for the private meal URL. Set its name in `WHATSAPP_REMINDER_TEMPLATE` and its approved language in `WHATSAPP_TEMPLATE_LANGUAGE`. Reminders are sent only to opted-in, unanswered participants within 15 minutes of cutoff. No claim is made that Meta will approve the template. Phone numbers and participant capabilities are encrypted at rest.

## Background execution

Set `TEAM_JOBS_ENABLED=true` when running `npm start` or the supplied Docker image. The web entrypoint starts a 30-second worker. It advances response cutoffs and weekly invitations, refreshes changed channel cards, and dispatches eligible WhatsApp reminders. A PostgreSQL advisory lock coordinates replicas. Workspaces are processed in rotating batches of 20; very large registries can delay updates and require a dedicated queue before scaling.

Alternatively, leave the internal worker disabled and run `npm run teams:jobs` every minute from a process supervisor with `MOODISH_PUBLIC_URL` and a random `TEAM_JOBS_SECRET` of at least 32 characters in its environment. It calls `POST /api/teams/jobs` with `X-Moodish-Jobs-Secret`. Do not place secrets in command arguments. The standalone agent entrypoint does not start the internal worker; use the external job in that configuration.

Weekly schedules create invitations only; they do not auto-select or purchase food. Revoking the schedule creator disables their schedule. Ambiguous provider failures are not blindly resent, to avoid duplicate messages; inspect operator logs and provider delivery status before recovery. If no scheduler is configured, manual dashboard operations work but automatic cutoffs, recurrence and card refresh do not run.

## Pilot and verification

Start with five offices for four weeks, each with one owner and a named purchaser. Measure time from invitation to checked decision, attendance response rate, reported spend against cap, repeat-meal use, and support interventions. Interview purchasers about reimbursement and invoice needs before building those features. Trial a flat office subscription only after repeat utility is demonstrated; no paid billing exists in this release. Position this as coordination for smaller teams, rather than promising managed catering fulfillment.

Run `npm test`, `MOODISH_TEST_DATABASE_URL=<disposable database> npm run test:postgres`, and `npm run test:e2e`. Tests include provider stubs, concurrent channel claims, revoked invitation replay, cross-process database attendance/weekly scheduling, and browser flows through handoff/report/repeat. They do not prove real provider credentials or Swiggy production approval. After activation, verify installation, pairing, one shared card update, opt-in/STOP, and a private meal link with a consenting test team before inviting customers.
