import crypto from "node:crypto";
import { runtimeSigningSecret } from "./runtime-secrets.mjs";

const googleFlows = new Map();

export function authConfiguration() {
  return {
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    swiggy: process.env.SWIGGY_OAUTH_ENABLED === "true",
    swiggyAccessUrl: "https://mcp.swiggy.com/builders/access/",
    demo: (process.env.SWIGGY_MODE || "fixture") === "fixture"
  };
}

export function startGoogleOAuth(publicOrigin) {
  if (!authConfiguration().google) throw unavailable("Google login needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET");
  const state = crypto.randomBytes(24).toString("base64url");
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const redirectUri = `${String(publicOrigin || publicUrl()).replace(/\/$/, "")}/api/auth/google/callback`;
  googleFlows.set(state, { verifier, redirectUri, expiresAt: Date.now() + 10 * 60_000 });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account"
  }).toString();
  return url.toString();
}

export async function completeGoogleOAuth({ code, state }) {
  const flow = googleFlows.get(String(state || ""));
  if (!flow || flow.expiresAt <= Date.now()) throw unavailable("Invalid or expired Google login");
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: flow.redirectUri,
      grant_type: "authorization_code",
      code_verifier: flow.verifier
    })
  });
  if (!tokenResponse.ok) throw unavailable(`Google token exchange failed with ${tokenResponse.status}`, 502);
  const tokens = await tokenResponse.json();
  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${tokens.access_token}` }
  });
  if (!profileResponse.ok) throw unavailable("Google profile lookup failed", 502);
  const profile = await profileResponse.json();
  googleFlows.delete(state);
  return {
    id: `google:${profile.sub}`,
    name: profile.name || profile.email?.split("@")[0] || "Google member",
    email: profile.email,
    picture: profile.picture,
    provider: "google"
  };
}

export function issueAuthCookie(user) {
  const payload = Buffer.from(
    JSON.stringify({ ...user, exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60 })
  ).toString("base64url");
  const signature = crypto.createHmac("sha256", runtimeSigningSecret("auth-session")).update(payload).digest("base64url");
  return `moodish_session=${payload}.${signature}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${
    process.env.NODE_ENV === "production" ? "; Secure" : ""
  }`;
}

export function clearAuthCookie() {
  return `moodish_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

export function readAuthUser(cookieHeader = "") {
  const token = String(cookieHeader)
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("moodish_session="))
    ?.slice("moodish_session=".length);
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = crypto.createHmac("sha256", runtimeSigningSecret("auth-session")).update(payload).digest("base64url");
  if (!safeEqual(expected, signature)) return null;
  try {
    const user = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return user.exp > Math.floor(Date.now() / 1000) ? user : null;
  } catch {
    return null;
  }
}

export function demoUser() {
  return { id: "demo:moodish", name: "Moodish guest", provider: "demo" };
}

function safeEqual(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function publicUrl() {
  return (process.env.MOODISH_PUBLIC_URL || "http://localhost:8787").replace(/\/$/, "");
}

function unavailable(message, status = 503) {
  const error = new Error(message);
  error.status = status;
  return error;
}
