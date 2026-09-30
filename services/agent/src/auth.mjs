import crypto from "node:crypto";
import { runtimeSigningSecret } from "./runtime-secrets.mjs";
import { getSecretSession, saveSecretSession, takeSecretSession, pruneExpiredFlows } from "./memory.mjs";
import { issueMobileExchange } from "./swiggy-auth.mjs";

const hash = value => crypto.createHash("sha256").update(String(value)).digest("base64url");
const loginFailure = (message, loginError, flowKind, status = 400) => Object.assign(new Error(message), { status, loginError, flowKind });

export function authConfiguration() {
  return {
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    swiggy: process.env.SWIGGY_OAUTH_ENABLED === "true",
    swiggyAccessUrl: "https://mcp.swiggy.com/builders/access/",
    demo: (process.env.SWIGGY_MODE || "fixture") === "fixture"
  };
}

// Flows are stored durably and redeemed once, so any replica or a restarted
// process can finish them. Web flows are bound to the starting browser; native
// flows end in a PKCE-checked exchange code instead of a token in the URL.
export async function startGoogleOAuth(publicOrigin, { mobileChallenge, browserBinding } = {}) {
  if (!authConfiguration().google) throw unavailable("Google login needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET");
  if (mobileChallenge !== undefined && !/^[A-Za-z0-9_-]{43}$/.test(mobileChallenge)) throw loginFailure("Update the Moodish app to sign in with Google", "update_required", "mobile");
  if (!mobileChallenge && !browserBinding) throw loginFailure("A bound login flow is required", "failed");
  const state = crypto.randomBytes(24).toString("base64url");
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const redirectUri = `${String(publicOrigin || publicUrl()).replace(/\/$/, "")}/api/auth/google/callback`;
  const expiresAt = Date.now() + 10 * 60_000;
  await saveSecretSession(`google-flow:${hash(state)}`, { verifier, redirectUri, mobileChallenge: mobileChallenge || null,
    binding: browserBinding ? hash(browserBinding) : null, expiresAt });
  await pruneExpiredFlows();
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

export async function completeGoogleOAuth({ code, state, browserBinding, denied }) {
  const key = `google-flow:${hash(state || "")}`;
  const flow = state ? await getSecretSession(key) : null;
  if (!flow) throw loginFailure("Invalid or expired Google login", "expired");
  const flowKind = flow.mobileChallenge ? "mobile" : "browser";
  if (flow.binding && flow.binding !== hash(browserBinding || "")) throw loginFailure("Finish Google login in the browser where you started it", "browser_mismatch", flowKind, 403);
  if (!await takeSecretSession(key) || flow.expiresAt <= Date.now()) throw loginFailure("Invalid or expired Google login", "expired", flowKind);
  if (denied || !code) throw loginFailure("Google login was cancelled", "declined", flowKind);
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
  if (!tokenResponse.ok) throw loginFailure(`Google token exchange failed with ${tokenResponse.status}`, "exchange_failed", flowKind, 502);
  const tokens = await tokenResponse.json();
  const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${tokens.access_token}` }
  });
  if (!profileResponse.ok) throw loginFailure("Google profile lookup failed", "exchange_failed", flowKind, 502);
  const profile = await profileResponse.json();
  const user = {
    id: `google:${profile.sub}`,
    name: profile.name || profile.email?.split("@")[0] || "Google member",
    email: profile.email,
    picture: profile.picture,
    provider: "google"
  };
  if (flow.mobileChallenge) return { mobile: true, user, exchangeCode: await issueMobileExchange({ user, challenge: flow.mobileChallenge }) };
  return { mobile: false, user };
}

export function signSessionToken(user) {
  const payload = Buffer.from(
    JSON.stringify({ ...user, typ: "session", exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60 })
  ).toString("base64url");
  const signature = crypto.createHmac("sha256", runtimeSigningSecret("auth-session")).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function issueAuthCookie(user) {
  const token = signSessionToken(user);
  return `moodish_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${
    process.env.NODE_ENV === "production" ? "; Secure" : ""
  }`;
}

export function clearAuthCookie() {
  return `moodish_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

export function readAuthUser(cookieHeader = "", authorizationHeader = "") {
  const bearerToken = String(authorizationHeader || "").startsWith("Bearer ")
    ? String(authorizationHeader).slice("Bearer ".length).trim()
    : null;
  const cookieToken = String(cookieHeader || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("moodish_session="))
    ?.slice("moodish_session=".length);
  for (const token of [bearerToken, cookieToken].filter(Boolean)) {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) continue;
  const expected = crypto.createHmac("sha256", runtimeSigningSecret("auth-session")).update(payload).digest("base64url");
  if (!safeEqual(expected, signature)) continue;
  try {
    const user = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    // Group tokens share the signing key; only session tokens (or older untyped
    // ones) identify a user.
    if (user.id && (user.typ === undefined || user.typ === "session") && user.exp > Math.floor(Date.now() / 1000)) return user;
  } catch {}
  }
  return null;
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
