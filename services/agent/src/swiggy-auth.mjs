import crypto from "node:crypto";
import { getSecretSession, saveSecretSession, takeSecretSession, deleteSecretSession, patchSecretSessionIfVersion, requireDurableLiveStorage } from "./memory.mjs";
import { LOGIN_ERRORS, claimFlow, hashValue as hash, loginFailure, newFlowSecrets, peekFlow, saveFlow } from "./login-flows.mjs";

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export async function startSwiggyOAuth({ redirectUri, user, browserBinding, mobileChallenge, groupSessionId } = {}) {
  requireDurableLiveStorage();
  if (!user?.id || (!browserBinding && !mobileChallenge)) throw fail("A bound login flow is required");
  if (mobileChallenge && !/^[A-Za-z0-9_-]{43}$/.test(mobileChallenge)) throw fail("Invalid mobile PKCE challenge");
  const callback = redirectUri || `${process.env.MOODISH_PUBLIC_URL || "http://localhost:8787"}/api/auth/swiggy/callback`;
  const { state, verifier, challenge } = newFlowSecrets({ stateBytes: 32 });
  const client = await authRequest("register", {
    client_name: "Moodish", redirect_uris: [callback], grant_types: ["authorization_code"],
    response_types: ["code"], token_endpoint_auth_method: "none"
  });
  if (!client.client_id) throw fail("Swiggy registration did not return a client identifier", 502);
  const flow = { user, redirectUri: callback, verifier, clientId: client.client_id,
    binding: browserBinding ? hash(browserBinding) : null, mobileChallenge, groupSessionId,
    expiresAt: Date.now() + 600000 };
  await saveFlow("swiggy", state, { encrypted: encryptToken(JSON.stringify(flow)), expiresAt: flow.expiresAt });
  const authorize = new URL("https://mcp.swiggy.com/auth/authorize");
  authorize.search = new URLSearchParams({ response_type: "code", client_id: client.client_id,
    redirect_uri: callback, code_challenge: challenge, code_challenge_method: "S256", state, scope: "mcp:tools" }).toString();
  return { authorizationUrl: authorize.toString(), expiresIn: 600 };
}

export async function completeSwiggyOAuth({ code, state, browserBinding, denied } = {}) {
  const record = await peekFlow("swiggy", state);
  if (!record) throw loginFailure("Invalid or expired Swiggy OAuth state", LOGIN_ERRORS.EXPIRED);
  const pending = JSON.parse(decryptToken(record.encrypted));
  const flowKind = pending.mobileChallenge ? "mobile" : "browser";
  if (pending.binding && pending.binding !== hash(browserBinding || "")) throw loginFailure("Login browser does not match this OAuth flow", LOGIN_ERRORS.BROWSER_MISMATCH, flowKind, 403);
  const claimed = await claimFlow("swiggy", state);
  if (!claimed || pending.expiresAt <= Date.now()) throw loginFailure("Invalid or expired Swiggy OAuth state", LOGIN_ERRORS.EXPIRED, flowKind);
  if (denied || !code) throw loginFailure("Swiggy connection was declined. You can try connecting again.", LOGIN_ERRORS.DECLINED, flowKind);
  let token;
  try {
    token = await authRequest("token", { grant_type: "authorization_code", code,
      code_verifier: pending.verifier, redirect_uri: pending.redirectUri, client_id: pending.clientId });
  } catch (error) { throw Object.assign(error, { loginError: LOGIN_ERRORS.EXCHANGE_FAILED, flowKind }); }
  if (!token.access_token || !Number.isFinite(Number(token.expires_in))) throw loginFailure("Swiggy returned an invalid token response", LOGIN_ERRORS.EXCHANGE_FAILED, flowKind, 502);
  const credential = { accessToken: encryptToken(token.access_token), expiresAt: Date.now() + Number(token.expires_in) * 1000,
    scope: token.scope, version: crypto.randomUUID() };
  if (pending.mobileChallenge) {
    // Whoever approves consent in a browser is not necessarily the device that
    // started the flow. The credential waits in the single-use exchange record
    // and is attached only when the starting app proves its PKCE verifier.
    const exchangeCode = await issueMobileExchange({ user: pending.user, challenge: pending.mobileChallenge, credential });
    return { connected: false, user: pending.user, exchangeCode, groupSessionId: pending.groupSessionId };
  }
  await saveSecretSession(`swiggy:${pending.user.id}`, credential);
  return { connected: true, user: pending.user, groupSessionId: pending.groupSessionId };
}

// A one-minute, single-use code the app redeems with its PKCE verifier. Used by
// both Swiggy and Google native sign-in so no session token travels in a URL.
export async function issueMobileExchange({ user, challenge, credential }) {
  const exchangeCode = crypto.randomBytes(32).toString("base64url");
  await saveSecretSession(`mobile:${hash(exchangeCode)}`, { user, challenge, expiresAt: Date.now() + 60000, ...(credential ? { credential } : {}) });
  return exchangeCode;
}

export async function exchangeMobileCode({ code, verifier } = {}) {
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(verifier || "")) throw fail("Invalid verifier");
  const key = `mobile:${hash(code || "")}`;
  const record = await getSecretSession(key);
  if (!record || record.expiresAt <= Date.now() || record.challenge !== hash(verifier)) throw fail("Invalid or expired app login code", 401);
  if (!await takeSecretSession(key)) throw fail("App login code already used", 401);
  if (record.credential) await saveSecretSession(`swiggy:${record.user.id}`, record.credential);
  return record.user;
}

export async function getSwiggyAccessToken(userId) {
  return (await getSwiggyCredential(userId))?.token || "";
}
export async function getSwiggyCredential(userId) {
  if (!userId) return null;
  const session = await getSecretSession(`swiggy:${userId}`);
  if (!session?.accessToken || session.expiresAt <= Date.now() + 60000) return null;
  return { token: decryptToken(session.accessToken), version: session.version };
}
// Marks one specific credential as rejected by Swiggy. The record stays so the
// account shows "expired". A reconnect starts fresh, including the address,
// because it may be a different Swiggy account.
export async function expireSwiggyConnection(userId, version) {
  if (!userId || !version) return false;
  return patchSecretSessionIfVersion(`swiggy:${userId}`, version, { accessToken: null, expiresAt: 0 });
}
export async function getSwiggyConnectionStatus(userId) {
  const session = userId ? await getSecretSession(`swiggy:${userId}`) : null;
  const connected = Boolean(session && session.expiresAt > Date.now() + 60000);
  return { connected, state: connected ? "connected" : session ? "expired" : "disconnected",
    expiresAt: session?.expiresAt ? new Date(session.expiresAt).toISOString() : null,
    requiresReauthentication: Boolean(session && !connected), selectedAddressId: session?.selectedAddressId || null };
}
export async function disconnectSwiggy(userId) { await deleteSecretSession(`swiggy:${userId}`); }
export async function selectSwiggyAddress(userId, addressId) {
  const session = await getSecretSession(`swiggy:${userId}`);
  if (!session) throw fail("Connect Swiggy first", 401);
  await saveSecretSession(`swiggy:${userId}`, { ...session, selectedAddressId: addressId });
}
async function authRequest(path, body) {
  let response;
  try {
    response = await fetch(`https://mcp.swiggy.com/auth/${path}`, { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  } catch { throw fail(`Swiggy ${path} could not be reached. Try again.`, 502); }
  if (!response.ok) throw fail(`Swiggy ${path} failed (HTTP ${response.status})`, response.status === 403 ? 403 : 502);
  return response.json();
}
function encryptionKey() {
  if (process.env.TOKEN_ENCRYPTION_KEY) return crypto.createHash("sha256").update(process.env.TOKEN_ENCRYPTION_KEY).digest();
  if (process.env.NODE_ENV === "production") throw fail("TOKEN_ENCRYPTION_KEY is required in production", 503);
  return crypto.createHash("sha256").update("moodish-local-development-only").digest();
}
export function encryptToken(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(x => x.toString("base64url")).join(".");
}
export function decryptToken(value) {
  const [iv, tag, encrypted] = String(value).split(".").map(x => Buffer.from(x, "base64url"));
  const cipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(encrypted), cipher.final()]).toString("utf8");
}
