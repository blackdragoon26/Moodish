import crypto from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

const teamsKeys = createRemoteJWKSet(
  new URL("https://login.botframework.com/v1/.well-known/keys")
);

export async function verifyPlatformRequest(platform, { headers, rawBody }) {
  if (platform === "slack") return verifySlack(headers, rawBody);
  if (platform === "discord") return verifyDiscord(headers, rawBody);
  if (platform === "teams") return verifyTeams(headers, rawBody);
  throw unauthorized("Unsupported collaboration platform");
}

export function platformCommandToSession(platform, payload, dashboardBase) {
  if (platform === "slack") {
    const params = new URLSearchParams(payload);
    return {
      dedupeKey: `slack:${params.get("trigger_id") || `${params.get("team_id")}:${params.get("channel_id")}:${params.get("user_id")}:${params.get("text")}`}`,
      args: {
        platform,
        workspaceId: params.get("team_id"),
        channelId: params.get("channel_id"),
        creatorId: params.get("user_id"),
        vibe: params.get("text") || "team lunch"
      },
      response: (session) => ({
        response_type: "in_channel",
        text: `Moodish group meal started. ${session.responseCount}/${session.headcount} preferences collected.`,
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: `*Moodish group meal*\n${session.vibe}\nTeam code: \`${session.invitePasscode}\`` }
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "Submit privately" },
                url: `${dashboardBase}/?group=${encodeURIComponent(session.sessionId)}&action=preferences`
              },
              {
                type: "button",
                text: { type: "plain_text", text: "Manager dashboard" },
                url: `${dashboardBase}/api/platforms/slack/oauth/start?sessionId=${encodeURIComponent(session.sessionId)}`
              }
            ]
          }
        ]
      })
    };
  }
  if (platform === "discord") {
    if (payload.type === 1) return { ping: true, response: () => ({ type: 1 }) };
    return {
      dedupeKey: `discord:${payload.id}`,
      args: {
        platform,
        workspaceId: payload.guild_id,
        channelId: payload.channel_id,
        creatorId: payload.member?.user?.id || payload.user?.id,
        vibe: payload.data?.options?.find((option) => option.name === "vibe")?.value || "team lunch"
      },
      response: (session) => ({
        type: 4,
        data: {
          content: `Moodish group meal started for “${session.vibe}”. Team code: ${session.invitePasscode}\nSubmit preferences privately: ${dashboardBase}/?group=${encodeURIComponent(session.sessionId)}&action=preferences\nManager dashboard: ${dashboardBase}/api/platforms/discord/oauth/start?sessionId=${encodeURIComponent(session.sessionId)}`,
          flags: 0
        }
      })
    };
  }
  return {
    dedupeKey: `teams:${payload.id}`,
    args: {
      platform,
      workspaceId: payload.channelData?.tenant?.id,
      channelId: payload.conversation?.id,
      creatorId: payload.from?.aadObjectId || payload.from?.id,
      vibe: String(payload.text || "team lunch").replace(/^\s*moodish\s*/i, "")
    },
    response: (session) => ({
      type: "message",
      text: `Moodish group meal started for “${session.vibe}”.`,
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          content: {
            type: "AdaptiveCard",
            version: "1.5",
            body: [
              { type: "TextBlock", text: "Submit preferences privately, then review the manager dashboard." },
              { type: "TextBlock", text: `Team code: ${session.invitePasscode}`, weight: "Bolder" }
            ],
            actions: [
              {
                type: "Action.OpenUrl",
                title: "Submit privately",
                url: `${dashboardBase}/?group=${encodeURIComponent(session.sessionId)}&action=preferences`
              },
              {
                type: "Action.OpenUrl",
                title: "Manager dashboard",
                url: `${dashboardBase}/api/platforms/teams/oauth/start?sessionId=${encodeURIComponent(session.sessionId)}`
              }
            ]
          }
        }
      ]
    })
  };
}

function verifySlack(headers, rawBody) {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) throw configuration("SLACK_SIGNING_SECRET is required");
  const timestamp = headers["x-slack-request-timestamp"];
  const signature = headers["x-slack-signature"];
  if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) throw unauthorized("Stale Slack request");
  const expected = `v0=${crypto.createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
  if (!safeEqual(expected, signature)) throw unauthorized("Invalid Slack signature");
  return true;
}

function verifyDiscord(headers, rawBody) {
  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  if (!publicKey) throw configuration("DISCORD_PUBLIC_KEY is required");
  const signature = headers["x-signature-ed25519"];
  const timestamp = headers["x-signature-timestamp"];
  if (!signature || !timestamp) throw unauthorized("Missing Discord signature");
  const key = Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"),
    Buffer.from(publicKey, "hex")
  ]);
  const valid = crypto.verify(
    null,
    Buffer.from(`${timestamp}${rawBody}`),
    { key, format: "der", type: "spki" },
    Buffer.from(signature, "hex")
  );
  if (!valid) throw unauthorized("Invalid Discord signature");
  return true;
}

async function verifyTeams(headers, rawBody) {
  const appId = process.env.TEAMS_APP_ID;
  if (!appId) throw configuration("TEAMS_APP_ID is required");
  const authorization = headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) throw unauthorized("Missing Teams bearer token");
  const { payload } = await jwtVerify(token, teamsKeys, {
    audience: appId,
    issuer: "https://api.botframework.com"
  });
  const activity = JSON.parse(rawBody || "{}");
  if (payload.serviceurl && activity.serviceUrl && payload.serviceurl !== activity.serviceUrl) {
    throw unauthorized("Teams serviceUrl claim does not match the activity");
  }
  return true;
}

function safeEqual(left, right = "") {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function unauthorized(message) {
  const error = new Error(message);
  error.status = 401;
  return error;
}

function configuration(message) {
  const error = new Error(message);
  error.status = 503;
  return error;
}
