import crypto from "node:crypto";
import { signGroupAccessToken } from "./access-token.mjs";
import { getGroupSession } from "./memory.mjs";

const flows = new Map();

export function startPlatformOAuth(platform, { sessionId, redirectUri } = {}) {
  const config = providerConfig(platform);
  const state = crypto.randomBytes(24).toString("base64url");
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const callback = redirectUri || `${publicBase()}/api/platforms/${platform}/oauth/callback`;
  flows.set(state, { platform, sessionId, redirectUri: callback, verifier, expiresAt: Date.now() + 10 * 60_000 });
  const url = new URL(config.authorizeUrl);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: callback,
    response_type: "code",
    ...(platform === "slack" ? { user_scope: config.scope } : { scope: config.scope }),
    state,
    ...(platform === "teams" ? { code_challenge: challenge, code_challenge_method: "S256" } : {})
  }).toString();
  return { authorizationUrl: url.toString(), state, expiresIn: 600 };
}

export async function completePlatformOAuth(platform, { code, state } = {}) {
  const flow = flows.get(String(state || ""));
  if (!flow || flow.platform !== platform || flow.expiresAt <= Date.now()) {
    flows.delete(String(state || ""));
    throw badRequest("Invalid or expired platform OAuth state");
  }
  const config = providerConfig(platform);
  const tokenResponse = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: flow.redirectUri,
      grant_type: "authorization_code",
      ...(platform === "teams" ? { code_verifier: flow.verifier } : {})
    })
  });
  if (!tokenResponse.ok) throw upstream(`${platform} OAuth token exchange failed with ${tokenResponse.status}`);
  const token = await tokenResponse.json();
  const actorId = await fetchPlatformActor(platform, token);
  const session = await getGroupSession(flow.sessionId);
  if (!session || (session.creatorId !== actorId && !session.coManagerIds.includes(actorId))) {
    const error = new Error("This platform identity is not a manager for the requested Moodish session");
    error.status = 403;
    throw error;
  }
  flows.delete(state);
  return {
    sessionId: flow.sessionId,
    actorId,
    accessToken: signGroupAccessToken({ sessionId: flow.sessionId, actorId, expiresInSeconds: 3600 })
  };
}

async function fetchPlatformActor(platform, token) {
  if (platform === "slack") {
    if (token.authed_user?.id) return String(token.authed_user.id);
    throw upstream("Slack OAuth response did not include an authenticated user");
  }
  const endpoint = platform === "discord" ? "https://discord.com/api/v10/users/@me" : "https://graph.microsoft.com/v1.0/me";
  const accessToken = token.access_token;
  const response = await fetch(endpoint, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw upstream(`${platform} identity lookup failed with ${response.status}`);
  const user = await response.json();
  return String(platform === "teams" ? user.id : user.id);
}

function providerConfig(platform) {
  if (platform === "slack") {
    return requiredConfig({
      clientId: process.env.SLACK_CLIENT_ID,
      clientSecret: process.env.SLACK_CLIENT_SECRET,
      authorizeUrl: "https://slack.com/oauth/v2/authorize",
      tokenUrl: "https://slack.com/api/oauth.v2.access",
      scope: "identity.basic"
    });
  }
  if (platform === "discord") {
    return requiredConfig({
      clientId: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      authorizeUrl: "https://discord.com/oauth2/authorize",
      tokenUrl: "https://discord.com/api/v10/oauth2/token",
      scope: "identify"
    });
  }
  if (platform === "teams") {
    const tenant = process.env.TEAMS_TENANT_ID || "common";
    return requiredConfig({
      clientId: process.env.TEAMS_APP_ID,
      clientSecret: process.env.TEAMS_CLIENT_SECRET,
      authorizeUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
      tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      scope: "openid profile User.Read"
    });
  }
  throw badRequest("Unsupported platform OAuth provider");
}

function requiredConfig(config) {
  if (!config.clientId || !config.clientSecret) {
    const error = new Error("Platform OAuth client credentials are not configured");
    error.status = 503;
    throw error;
  }
  return config;
}

function publicBase() {
  return (process.env.MOODISH_PUBLIC_URL || "http://localhost:8787").replace(/\/$/, "");
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function upstream(message) {
  const error = new Error(message);
  error.status = 502;
  return error;
}
