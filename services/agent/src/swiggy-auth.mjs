import crypto from "node:crypto";
import { getSecretSession, saveSecretSession } from "./memory.mjs";

const pendingFlows = new Map();
const tokenSessions = new Map();
const DEFAULT_SESSION = "default";

export async function startSwiggyOAuth({ redirectUri, sessionId = DEFAULT_SESSION } = {}) {
  const callback = redirectUri || defaultRedirectUri();
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const state = crypto.randomBytes(24).toString("base64url");
  const client = await registerClient(callback);
  pendingFlows.set(state, {
    sessionId,
    redirectUri: callback,
    verifier,
    clientId: client.client_id,
    expiresAt: Date.now() + 10 * 60_000
  });
  const authorize = new URL("https://mcp.swiggy.com/auth/authorize");
  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: callback,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    scope: "mcp:tools mcp:resources mcp:prompts"
  }).toString();
  return { authorizationUrl: authorize.toString(), state, expiresIn: 600 };
}

export async function completeSwiggyOAuth({ code, state } = {}) {
  const flow = pendingFlows.get(String(state || ""));
  if (!flow || flow.expiresAt <= Date.now()) {
    pendingFlows.delete(String(state || ""));
    const error = new Error("Invalid or expired Swiggy OAuth state");
    error.status = 400;
    throw error;
  }
  const response = await fetch("https://mcp.swiggy.com/auth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      code_verifier: flow.verifier,
      redirect_uri: flow.redirectUri,
      client_id: flow.clientId
    })
  });
  if (!response.ok) {
    const error = new Error(`Swiggy OAuth token exchange failed with ${response.status}`);
    error.status = 502;
    throw error;
  }
  const token = await response.json();
  const storedSession = {
    accessToken: encryptToken(token.access_token),
    expiresAt: Date.now() + Number(token.expires_in || 432000) * 1000,
    scope: token.scope
  };
  tokenSessions.set(flow.sessionId, storedSession);
  await saveSecretSession(`swiggy:${flow.sessionId}`, storedSession);
  pendingFlows.delete(state);
  return { connected: true, sessionId: flow.sessionId, expiresAt: new Date(tokenSessions.get(flow.sessionId).expiresAt).toISOString() };
}

export async function getSwiggyAccessToken(sessionId = DEFAULT_SESSION) {
  if (process.env.SWIGGY_ACCESS_TOKEN) return process.env.SWIGGY_ACCESS_TOKEN;
  const session = tokenSessions.get(sessionId) || (await getSecretSession(`swiggy:${sessionId}`));
  if (!session || session.expiresAt <= Date.now() + 60_000) return "";
  return decryptToken(session.accessToken);
}

export async function getSwiggyConnectionStatus(sessionId = DEFAULT_SESSION) {
  const session = tokenSessions.get(sessionId) || (await getSecretSession(`swiggy:${sessionId}`));
  return {
    connected: Boolean(process.env.SWIGGY_ACCESS_TOKEN || (session && session.expiresAt > Date.now() + 60_000)),
    expiresAt: session?.expiresAt ? new Date(session.expiresAt).toISOString() : null,
    requiresReauthentication: Boolean(session && session.expiresAt <= Date.now() + 60_000)
  };
}

async function registerClient(redirectUri) {
  const response = await fetch("https://mcp.swiggy.com/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Moodish",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none"
    })
  });
  if (!response.ok) {
    const error = new Error(`Swiggy dynamic client registration failed with ${response.status}`);
    error.status = 502;
    throw error;
  }
  return response.json();
}

function defaultRedirectUri() {
  const base = process.env.MOODISH_PUBLIC_URL || "http://localhost:8787";
  return `${base.replace(/\/$/, "")}/api/swiggy/oauth/callback`;
}

function encryptionKey() {
  const configured = process.env.TOKEN_ENCRYPTION_KEY;
  if (configured) return crypto.createHash("sha256").update(configured).digest();
  if (process.env.NODE_ENV === "production") {
    const error = new Error("TOKEN_ENCRYPTION_KEY is required in production");
    error.status = 503;
    throw error;
  }
  return crypto.createHash("sha256").update("moodish-local-development-only").digest();
}

function encryptToken(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

function decryptToken(value) {
  const [iv, tag, encrypted] = String(value).split(".").map((part) => Buffer.from(part, "base64url"));
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
