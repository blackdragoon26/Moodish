import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createServer } from "../services/agent/src/server.mjs";
import { readAuthUser, signSessionToken } from "../services/agent/src/auth.mjs";
import { signGroupAccessToken, verifyGroupAccessToken } from "../services/agent/src/access-token.mjs";
import { runtimeSigningSecret } from "../services/agent/src/runtime-secrets.mjs";

const sha = value => crypto.createHash("sha256").update(value).digest("base64url");

async function googleApp(t) {
  const previous = { GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET };
  Object.assign(process.env, { GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret" });
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("http://127.0.0.1")) return originalFetch(url, init);
    calls.push(String(url));
    if (String(url).includes("oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "google-access" }));
    if (String(url).includes("openidconnect.googleapis.com")) return new Response(JSON.stringify({ sub: "12345", name: "Ada Lovelace", email: "ada@example.com" }));
    throw new Error(`Unexpected fetch to ${url}`);
  };
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    globalThis.fetch = originalFetch;
    server.close();
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (path, cookie) => originalFetch(base + path, { redirect: "manual", headers: cookie ? { cookie } : {} });
  return { base, get, calls, post: (path, body) => originalFetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) };
}
const cookieOf = (response, name) => (response.headers.getSetCookie().find(line => line.startsWith(`${name}=`)) || "").split(";")[0];

test("web Google login is bound to the starting browser and redeemed once", async t => {
  const app = await googleApp(t);
  const start = await app.get("/api/auth/google/start");
  const state = new URL(start.headers.get("location")).searchParams.get("state");
  const flowCookie = cookieOf(start, "moodish_google_flow");
  assert.ok(flowCookie.length > "moodish_google_flow=".length);
  assert.equal((await app.get(`/api/auth/google/callback?state=${state}&code=c`)).headers.get("location"), "/?login_error=browser_mismatch");
  assert.equal((await app.get(`/api/auth/google/callback?state=${state}&code=c`, "moodish_google_flow=attacker")).headers.get("location"), "/?login_error=browser_mismatch");
  const done = await app.get(`/api/auth/google/callback?state=${state}&code=c`, flowCookie);
  assert.equal(done.headers.get("location"), "/?login=google");
  assert.equal(readAuthUser(cookieOf(done, "moodish_session")).id, "google:12345");
  const replay = await app.get(`/api/auth/google/callback?state=${state}&code=c`, flowCookie);
  assert.equal(replay.headers.get("location"), "/?login_error=expired");
  assert.equal(app.calls.filter(url => url.includes("/token")).length, 1);
});

test("a cancelled web Google login returns a reason and redeems nothing", async t => {
  const app = await googleApp(t);
  const start = await app.get("/api/auth/google/start");
  const state = new URL(start.headers.get("location")).searchParams.get("state");
  const denied = await app.get(`/api/auth/google/callback?state=${state}&error=access_denied`, cookieOf(start, "moodish_google_flow"));
  assert.equal(denied.headers.get("location"), "/?login_error=declined");
  assert.equal(app.calls.length, 0);
});

test("native Google login returns a verifier-bound code, never a token in the URL", async t => {
  const app = await googleApp(t);
  const verifier = crypto.randomBytes(32).toString("base64url");
  const start = await app.get(`/api/auth/google/start?client=mobile&challenge=${sha(verifier)}`);
  assert.equal(cookieOf(start, "moodish_google_flow"), "", "native flows use PKCE, not a browser cookie");
  const state = new URL(start.headers.get("location")).searchParams.get("state");
  const callback = await app.get(`/api/auth/google/callback?state=${state}&code=c`);
  const location = new URL(callback.headers.get("location"));
  assert.equal(location.protocol, "moodish:");
  assert.equal(location.searchParams.get("token"), null);
  const code = location.searchParams.get("code");
  assert.equal((await app.post("/api/auth/mobile/exchange", { code, verifier: crypto.randomBytes(32).toString("base64url") })).status, 401);
  const exchanged = await (await app.post("/api/auth/mobile/exchange", { code, verifier })).json();
  assert.equal(readAuthUser("", `Bearer ${exchanged.token}`).id, "google:12345");
  assert.equal((await app.post("/api/auth/mobile/exchange", { code, verifier })).status, 401, "single use");
});

test("an older app without a PKCE challenge is told to update, and receives no token", async t => {
  const app = await googleApp(t);
  for (const query of ["client=mobile", "client=mobile&challenge=short"]) {
    const start = await app.get(`/api/auth/google/start?${query}`);
    assert.equal(start.headers.get("location"), "moodish://auth-callback?error=update_required");
  }
  assert.equal(app.calls.length, 0);
});

test("session and group tokens cannot stand in for each other", t => {
  // Production signs both kinds with the same configured key.
  const previous = process.env.GROUP_SESSION_SIGNING_KEY;
  process.env.GROUP_SESSION_SIGNING_KEY = "shared-test-signing-key-0123456789abcdef";
  t.after(() => { if (previous === undefined) delete process.env.GROUP_SESSION_SIGNING_KEY; else process.env.GROUP_SESSION_SIGNING_KEY = previous; });
  const session = signSessionToken({ id: "google:1", name: "A" });
  const group = signGroupAccessToken({ sessionId: "group-1", actorId: "google:1" });
  assert.equal(readAuthUser("", `Bearer ${group}`), null);
  assert.throws(() => verifyGroupAccessToken(session, "group-1"), { status: 401 });
  assert.equal(readAuthUser("", `Bearer ${session}`).id, "google:1");
  assert.equal(verifyGroupAccessToken(group, "group-1").actorId, "google:1");
  // Even when a payload carries the other kind's fields, its type decides.
  const sessionShapedLikeGroup = signSessionToken({ id: "google:1", sessionId: "group-1", actorId: "google:1" });
  assert.throws(() => verifyGroupAccessToken(sessionShapedLikeGroup, "group-1"), { status: 401 });
  const sign = payload => { const body = Buffer.from(JSON.stringify(payload)).toString("base64url"); return `${body}.${crypto.createHmac("sha256", runtimeSigningSecret("group-session")).update(body).digest("base64url")}`; };
  const groupWithId = sign({ typ: "group", id: "google:1", sessionId: "group-1", actorId: "google:1", exp: Math.floor(Date.now() / 1000) + 60 });
  assert.equal(readAuthUser("", `Bearer ${groupWithId}`), null);
  // Group tokens issued before the type claim still work for their remaining hour.
  const legacyGroup = sign({ sessionId: "group-1", actorId: "google:1", exp: Math.floor(Date.now() / 1000) + 60 });
  assert.equal(verifyGroupAccessToken(legacyGroup, "group-1").actorId, "google:1");
  const legacySession = sign({ id: "google:1", sessionId: "group-1", actorId: "google:1", exp: Math.floor(Date.now() / 1000) + 60 });
  assert.throws(() => verifyGroupAccessToken(legacySession, "group-1"), { status: 401 }, "an untyped token with a user id is not a group token");
});

test("Google and platform logins require durable storage in production live mode", { skip: Boolean(process.env.DATABASE_URL) && "this process has a database" }, async t => {
  const keys = ["NODE_ENV", "SWIGGY_MODE", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { NODE_ENV: "production", SWIGGY_MODE: "live", GOOGLE_CLIENT_ID: "c", GOOGLE_CLIENT_SECRET: "s", SLACK_CLIENT_ID: "c", SLACK_CLIENT_SECRET: "s" });
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const { startGoogleOAuth } = await import("../services/agent/src/auth.mjs");
  const { startPlatformOAuth } = await import("../services/agent/src/platform-oauth.mjs");
  await assert.rejects(startGoogleOAuth("https://moodish.example", { browserBinding: "b" }), { status: 503 });
  await assert.rejects(startPlatformOAuth("slack", { sessionId: "group-1" }), { status: 503 });
});
