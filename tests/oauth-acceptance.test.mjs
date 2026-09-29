import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { startLiveApp, cookieValue } from "./helpers/live-app.mjs";
import { saveSecretSession, getSecretSession } from "../services/agent/src/memory.mjs";
import { expireSwiggyConnection } from "../services/agent/src/swiggy-auth.mjs";

const sha = value => crypto.createHash("sha256").update(value).digest("base64url");
const errorOf = location => new URL(location, "http://x").searchParams.get("swiggy_error") ?? new URL(location).searchParams.get("error");

test("browser OAuth connects, binds the browser, and never accepts a replayed callback", async t => {
  const app = await startLiveApp(t);
  const alice = app.user(`google:alice-1-${crypto.randomUUID()}`);
  const connected = await app.connect(alice);
  assert.equal(connected.callback.status, 302);
  assert.equal(connected.location, "/?login=swiggy");
  const authorize = new URL(connected.authorizationUrl);
  assert.equal(authorize.origin + authorize.pathname, "https://mcp.swiggy.com/auth/authorize");
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorize.searchParams.get("redirect_uri"), "http://127.0.0.1:8787/api/auth/swiggy/callback");
  assert.equal((await app.request("/api/swiggy/connection", { session: alice })).body.connected, true);

  // Replaying the same callback (same state, same browser) cannot reconnect.
  const replay = await fetch(`${app.base}/api/auth/swiggy/callback?${connected.query}`, { redirect: "manual",
    headers: { cookie: `moodish_swiggy_flow=${connected.flowCookie}` } });
  assert.equal(replay.status, 302);
  assert.equal(errorOf(replay.headers.get("location")), "expired");
  assert.equal(cookieValue(replay.headers, "moodish_session"), null);
  assert.equal(app.fake.calls("token").length, 1, "the replay never reached the token endpoint");
});

test("a callback from another browser or without the flow cookie is refused and does not burn the flow", async t => {
  const app = await startLiveApp(t);
  const alice = app.user(`google:alice-2-${crypto.randomUUID()}`);
  let original;
  const wrong = await app.connect(alice, { tamper: request => { original = { ...request, query: new URLSearchParams(request.query) }; request.flowCookie = "attacker-browser"; } });
  assert.equal(errorOf(wrong.location), "browser_mismatch");
  const missing = await fetch(`${app.base}/api/auth/swiggy/callback?${original.query}`, { redirect: "manual" });
  assert.equal(errorOf(missing.headers.get("location")), "browser_mismatch");
  assert.equal(app.fake.calls("token").length, 0);
  assert.equal((await app.request("/api/swiggy/connection", { session: alice })).body.connected, false);
  // The rightful browser can still finish its own flow.
  const rightful = await fetch(`${app.base}/api/auth/swiggy/callback?${original.query}`, { redirect: "manual",
    headers: { cookie: `moodish_swiggy_flow=${original.flowCookie}` } });
  assert.equal(rightful.headers.get("location"), "/?login=swiggy");
});

test("cancellation or denial consumes the flow and returns a readable reason to the web app", async t => {
  const app = await startLiveApp(t);
  const alice = app.user(`google:alice-3-${crypto.randomUUID()}`);
  const denied = await app.connect(alice, { deny: true });
  assert.equal(errorOf(denied.location), "declined");
  assert.equal(cookieValue(denied.callback.headers, "moodish_swiggy_flow"), null, "the flow cookie is cleared");
  // A late code for the same state is refused because the state was consumed.
  const late = await fetch(`${app.base}/api/auth/swiggy/callback?state=${denied.grant.state}&code=late`, { redirect: "manual",
    headers: { cookie: `moodish_swiggy_flow=${denied.flowCookie}` } });
  assert.equal(errorOf(late.headers.get("location")), "expired");
  assert.equal(app.fake.calls("token").length, 0);
  // No provider-controlled text is reflected into the redirect.
  const injected = await fetch(`${app.base}/api/auth/swiggy/callback?state=unknown&error=%3Cscript%3E`, { redirect: "manual" });
  assert.equal(injected.headers.get("location"), "/?swiggy_error=expired");
});

test("an expired OAuth state is rejected even with a valid code", async t => {
  const app = await startLiveApp(t);
  const alice = app.user(`google:alice-4-${crypto.randomUUID()}`);
  const realNow = Date.now;
  const expired = await app.connect(alice, { tamper: () => { Date.now = () => realNow() + 11 * 60_000; } });
  Date.now = realNow;
  assert.equal(errorOf(expired.location), "expired");
  assert.equal(app.fake.calls("token").length, 0);
});

test("an authorization code issued for another flow fails PKCE and connects nothing", async t => {
  const app = await startLiveApp(t);
  const alice = app.user(`google:alice-5-${crypto.randomUUID()}`);
  // The attacker completes consent for their own flow and injects that code into
  // the victim's callback. Swiggy binds codes to the PKCE challenge, so the
  // victim's stored verifier cannot redeem it.
  const attackerStart = await fetch(`${app.base}/api/auth/swiggy/start`, { redirect: "manual" });
  const attackerGrant = app.fake.authorize(attackerStart.headers.get("location"), { accessToken: "attacker-token" });
  const victim = await app.connect(alice, { tamper: request => request.query.set("code", attackerGrant.code) });
  assert.equal(errorOf(victim.location), "exchange_failed");
  assert.equal((await app.request("/api/swiggy/connection", { session: alice })).body.connected, false);
  assert.equal(app.fake.calls("token").length, 1);
});

test("native OAuth returns a short-lived single-use code that needs the app's PKCE verifier", async t => {
  const app = await startLiveApp(t);
  const alice = app.user(`google:alice-6-${crypto.randomUUID()}`);
  const verifier = crypto.randomBytes(32).toString("base64url");
  const start = await app.request("/api/swiggy/oauth/start", { body: { mobileChallenge: sha(verifier) }, session: alice, sessionHeader: "native" });
  assert.equal(start.status, 200);
  assert.equal(start.headers.get("set-cookie"), null, "native flows do not rely on a browser cookie");
  const grant = app.fake.authorize(start.body.authorizationUrl);
  const callback = await fetch(`${app.base}/api/auth/swiggy/callback?state=${grant.state}&code=${grant.code}`, { redirect: "manual" });
  const location = new URL(callback.headers.get("location"));
  assert.equal(location.protocol, "moodish:");
  const code = location.searchParams.get("code");
  assert.ok(code);
  assert.equal((await app.request("/api/auth/mobile/exchange", { body: { code, verifier: crypto.randomBytes(32).toString("base64url") } })).status, 401);
  const exchanged = await app.request("/api/auth/mobile/exchange", { body: { code, verifier } });
  assert.equal(exchanged.status, 200, "a wrong verifier does not burn the code");
  assert.match(exchanged.body.user.id, /^google:alice-/);
  assert.equal((await app.request("/api/swiggy/connection", { session: exchanged.body.token, sessionHeader: "native" })).body.connected, true);
  assert.equal((await app.request("/api/auth/mobile/exchange", { body: { code, verifier } })).status, 401, "codes are single use");
});

test("native exchange codes expire, and native denial returns to the app with a reason", async t => {
  const app = await startLiveApp(t);
  const verifier = crypto.randomBytes(32).toString("base64url");
  const start = await app.request("/api/swiggy/oauth/start", { body: { mobileChallenge: sha(verifier) } });
  const grant = app.fake.authorize(start.body.authorizationUrl);
  const callback = await fetch(`${app.base}/api/auth/swiggy/callback?state=${grant.state}&code=${grant.code}`, { redirect: "manual" });
  const code = new URL(callback.headers.get("location")).searchParams.get("code");
  const realNow = Date.now;
  Date.now = () => realNow() + 61_000;
  try {
    assert.equal((await app.request("/api/auth/mobile/exchange", { body: { code, verifier } })).status, 401);
  } finally { Date.now = realNow; }

  const second = await app.request("/api/swiggy/oauth/start", { body: { mobileChallenge: sha(verifier) } });
  const denied = app.fake.authorize(second.body.authorizationUrl, { deny: true });
  const deniedCallback = await fetch(`${app.base}/api/auth/swiggy/callback?state=${denied.state}&error=access_denied`, { redirect: "manual" });
  assert.equal(deniedCallback.headers.get("location"), "moodish://auth-callback?error=declined");
  assert.equal((await app.request("/api/swiggy/oauth/start", { body: { mobileChallenge: "too-short" } })).status, 400);
});

test("the registered callback is the configured origin, whatever the request host", async t => {
  const app = await startLiveApp(t, { env: { MOODISH_PUBLIC_URL: "https://moodish.example" } });
  const start = await fetch(`${app.base}/api/auth/swiggy/start`, { redirect: "manual",
    headers: { "x-forwarded-host": "attacker.example", "x-forwarded-proto": "https" } });
  assert.equal(new URL(start.headers.get("location")).searchParams.get("redirect_uri"), "https://moodish.example/api/auth/swiggy/callback");
  const cross = await app.request("/api/swiggy/oauth/start", { body: { mobileChallenge: sha("x".repeat(43)) }, headers: { origin: "https://attacker.example" } });
  assert.equal(cross.status, 403, "cross-origin browser POSTs are refused");
});

test("production live mode refuses to start OAuth without durable storage", { skip: Boolean(process.env.DATABASE_URL) && "this process has a database" }, async t => {
  const app = await startLiveApp(t, { env: { NODE_ENV: "production", MOODISH_PUBLIC_URL: "https://moodish.example" } });
  const start = await app.request("/api/auth/swiggy/start");
  assert.equal(start.status, 503);
  assert.match(start.body.error, /DATABASE_URL/);
  assert.equal(app.fake.state.registered, 0);
});

test("revoked Swiggy access expires only that credential and keeps the chosen address for reconnect", async t => {
  const app = await startLiveApp(t);
  const alice = app.user(`google:alice-7-${crypto.randomUUID()}`);
  await app.connect(alice, { accessToken: "alice-first" });
  assert.equal((await app.request("/api/swiggy/address", { body: { addressId: "addr-2" }, session: alice })).status, 200);
  app.fake.fault("get_addresses", { http: 401 });
  const rejected = await app.request("/api/swiggy/addresses", { session: alice });
  assert.equal(rejected.status, 401);
  assert.match(rejected.body.error, /Reconnect/);
  const status = (await app.request("/api/swiggy/connection", { session: alice })).body;
  assert.deepEqual([status.connected, status.state, status.requiresReauthentication, status.selectedAddressId], [false, "expired", true, "addr-2"]);
  const aliceId = JSON.parse(Buffer.from(alice.split(".")[0], "base64url")).id;
  const stored = await getSecretSession(`swiggy:${aliceId}`);
  assert.equal(stored.accessToken, null, "the rejected token is not kept");
  app.fake.clearFaults();
  await app.connect(alice, { accessToken: "alice-second" });
  assert.equal((await app.request("/api/swiggy/addresses", { session: alice })).status, 200);
  assert.equal(app.fake.calls("get_addresses").at(-1).token, "alice-second");
});

test("a 401 for an old credential cannot expire a newer reconnect", async () => {
  await saveSecretSession("swiggy:race-user", { accessToken: "encrypted-new", expiresAt: Date.now() + 3_600_000, version: "new" });
  assert.equal(await expireSwiggyConnection("race-user", "old"), false);
  assert.equal((await getSecretSession("swiggy:race-user")).accessToken, "encrypted-new");
  assert.equal(await expireSwiggyConnection("race-user", "new"), true);
});

test("disconnect removes the credential; reconnect creates a new connection version", async t => {
  const app = await startLiveApp(t);
  const alice = app.user(`google:alice-8-${crypto.randomUUID()}`);
  await app.connect(alice);
  const aliceId = JSON.parse(Buffer.from(alice.split(".")[0], "base64url")).id;
  const first = (await getSecretSession(`swiggy:${aliceId}`)).version;
  assert.equal((await app.request("/api/swiggy/disconnect", { body: {}, session: alice })).body.connected, false);
  assert.equal((await app.request("/api/swiggy/connection", { session: alice })).body.state, "disconnected");
  assert.equal((await app.request("/api/swiggy/addresses", { session: alice })).status, 401);
  assert.equal(app.fake.calls("get_addresses").length, 0, "no upstream call without a credential");
  await app.connect(alice);
  assert.notEqual((await getSecretSession(`swiggy:${aliceId}`)).version, first);
});

test("standalone Swiggy login creates a new Moodish identity with its own connection", async t => {
  const app = await startLiveApp(t);
  const standalone = await app.connect(null);
  assert.equal(standalone.location, "/?login=swiggy");
  assert.ok(standalone.session);
  const me = await app.request("/api/auth/me", { session: standalone.session });
  assert.match(me.body.user.id, /^swiggy:/);
  assert.equal((await app.request("/api/swiggy/connection", { session: standalone.session })).body.connected, true);
});
