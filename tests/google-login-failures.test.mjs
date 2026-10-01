import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createServer } from "../services/agent/src/server.mjs";

const sha = value => crypto.createHash("sha256").update(value).digest("base64url");

// Real start and callback routes; only Google's two endpoints are replaced, by
// `google(url)` returning a Response, throwing, or never settling.
async function googleApp(t, google) {
  const previous = { GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET };
  Object.assign(process.env, { GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret" });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => String(url).startsWith("http://127.0.0.1") ? originalFetch(url, init) : google(String(url), init);
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    globalThis.fetch = originalFetch;
    server.closeAllConnections();
    server.close();
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  // Starts a native (PKCE) sign-in and returns where Google's callback sends the app.
  return async function nativeCallback() {
    const verifier = crypto.randomBytes(32).toString("base64url");
    const start = await originalFetch(`${base}/api/auth/google/start?client=mobile&challenge=${sha(verifier)}`, { redirect: "manual" });
    const state = new URL(start.headers.get("location")).searchParams.get("state");
    const callback = await originalFetch(`${base}/api/auth/google/callback?state=${state}&code=c`, { redirect: "manual" });
    return { location: callback.headers.get("location"), setCookie: callback.headers.get("set-cookie") };
  };
}

test("a native Google sign-in whose token request fails on the network returns to the app with exchange_failed", async t => {
  const nativeCallback = await googleApp(t, async () => { throw new TypeError("fetch failed"); });
  const result = await nativeCallback();
  assert.equal(result.location, "moodish://auth-callback?error=exchange_failed");
  assert.equal(result.setCookie, null, "no session is issued");
});

test("a native Google sign-in whose profile request fails on the network returns to the app with exchange_failed", async t => {
  const nativeCallback = await googleApp(t, async url => {
    if (url.includes("/token")) return new Response(JSON.stringify({ access_token: "google-access" }));
    throw new TypeError("fetch failed");
  });
  const result = await nativeCallback();
  assert.equal(result.location, "moodish://auth-callback?error=exchange_failed");
  assert.equal(result.setCookie, null);
});

test("a native Google sign-in that gets an unreadable token or profile response returns to the app with exchange_failed", async t => {
  for (const broken of ["/token", "/userinfo"]) {
    const nativeCallback = await googleApp(t, async url => {
      if (url.includes(broken)) return new Response("<html>gateway error</html>");
      return new Response(JSON.stringify(url.includes("/token") ? { access_token: "google-access" } : { sub: "1", name: "A" }));
    });
    const result = await nativeCallback();
    assert.equal(result.location, "moodish://auth-callback?error=exchange_failed", broken);
    assert.equal(result.setCookie, null);
  }
});

test("a Google request that hangs is abandoned and the native sign-in returns with exchange_failed", async t => {
  const previous = process.env.GOOGLE_HTTP_TIMEOUT_MS;
  process.env.GOOGLE_HTTP_TIMEOUT_MS = "200";
  t.after(() => { if (previous === undefined) delete process.env.GOOGLE_HTTP_TIMEOUT_MS; else process.env.GOOGLE_HTTP_TIMEOUT_MS = previous; });
  // Like real fetch: never answers, rejects only when its abort signal fires.
  const nativeCallback = await googleApp(t, (url, init) => new Promise((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation timed out.", "TimeoutError")));
  }));
  const started = Date.now();
  const result = await Promise.race([nativeCallback(), new Promise(resolve => setTimeout(() => resolve({ location: "still waiting" }), 3000))]);
  assert.equal(result.location, "moodish://auth-callback?error=exchange_failed");
  assert.ok(Date.now() - started < 3000);
});

test("a Google reply without a token or a profile id signs nobody in", async t => {
  for (const reply of [{ token: {}, profile: { sub: "1" } }, { token: { access_token: "a" }, profile: { name: "No Id" } }]) {
    const nativeCallback = await googleApp(t, async url => new Response(JSON.stringify(url.includes("/token") ? reply.token : reply.profile)));
    const result = await nativeCallback();
    assert.equal(result.location, "moodish://auth-callback?error=exchange_failed", JSON.stringify(reply));
  }
});
